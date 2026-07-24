/**
 * Orquestrador de ingestão da Série Histórica de Preços de Combustíveis (ANP).
 *
 * Pipeline (todo o trabalho pesado roda **fora de qualquer request HTTP** — H5):
 *   1. abre um registro em `ingestion_runs` (observabilidade — H3);
 *   2. baixa o CSV (Latin-1) com timeout/retry;
 *   3. calcula o hash do conteúdo e **pula** se este arquivo já foi ingerido com
 *      sucesso antes (requisição condicional por conteúdo — H2);
 *   4. parseia → normaliza → deduplica → faz upsert idempotente no Supabase;
 *   5. fecha o registro com contagens (lidas/inseridas/rejeitadas), duração e status.
 *
 * Fonte (dado aberto): Série Histórica de Preços de Combustíveis — ANP.
 * A URL exata do arquivo é configurável via env `ANP_CSV_URL` (a ANP publica um
 * arquivo por semestre; o layout SHPC é estável — ver anpParser).
 */

import crypto from "crypto";
import { supabase } from "../config/supabaseClient";
import { logger } from "../lib/logger";
import { fetchConditional } from "../scrapers/httpClient";
import { parseAnpCsv } from "./anpParser";
import { normalizeFuelRows, dedupeFuelRows } from "./anpNormalize";
import { filterValidRows } from "./anpRowSchema";
import { upsertFuelPrices } from "../services/fuelPriceService";

/**
 * Estrutura real dos arquivos da ANP (SHPC — revenda automotiva).
 *
 * Os dados são publicados em CSVs **mensais**, dentro de `.../shpc/dsan/ANO/`, e
 * **separados por grupo de produto**: `precos-gasolina-etanol-MM.csv` e
 * `precos-diesel-gnv-MM.csv` (GLP é um arquivo à parte, fora do escopo automotivo).
 * Não há sufixo `/@@download/file` — é o `.csv` direto. Cada arquivo cobre um mês.
 *
 * Como são vários arquivos, o ingestor baixa uma **lista** deles (um por grupo × mês)
 * e ingere cada um pelo mesmo pipeline idempotente. Um 404 (mês ainda não publicado)
 * é apenas pulado, sem derrubar o lote.
 */
const ANP_BASE =
  "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/shpc/dsan";
const ANP_GROUPS = ["gasolina-etanol", "diesel-gnv"] as const;

/**
 * Monta a lista de URLs a ingerir a partir de env:
 *  - `ANP_YEAR`   (padrão "2025" — último ano publicado no portal)
 *  - `ANP_MONTHS` (padrão "10,11,12" — trimestre recente; dá série semanal ao gráfico)
 * Um `ANP_CSV_URL` explícito (arquivo único) tem precedência e ignora o resto.
 */
export function buildAnpUrls(): string[] {
  const single = process.env.ANP_CSV_URL?.trim();
  if (single) return [single];

  const year = (process.env.ANP_YEAR || "2025").trim();
  const months = (process.env.ANP_MONTHS || "10,11,12")
    .split(",")
    .map((m) => m.trim().padStart(2, "0"))
    .filter((m) => /^\d{2}$/.test(m));

  const urls: string[] = [];
  for (const month of months) {
    for (const group of ANP_GROUPS) {
      urls.push(`${ANP_BASE}/${year}/precos-${group}-${month}.csv`);
    }
  }
  return urls;
}

export interface IngestOptions {
  /** URL única a ingerir (sobrepõe a lista padrão). Usado pelo `--url` do script. */
  url?: string;
  /** Lista explícita de URLs (sobrepõe o padrão do env). */
  urls?: string[];
  /** Rótulo-base da fonte para o registro de ingestão (o nome do arquivo é anexado). */
  source?: string;
}

export interface IngestResult {
  status: "success" | "skipped" | "error";
  runId?: number;
  rowsRead: number;
  rowsUpserted: number;
  rowsRejected: number;
  fileHash?: string;
  durationMs: number;
  message?: string;
}

interface CachingValidators {
  etag: string | null;
  lastModified: string | null;
}

/** sha256 hex do conteúdo baixado — identidade de conteúdo do arquivo (H2). */
function hashContent(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Verifica se um arquivo com este hash já foi ingerido com sucesso antes.
 * Evita reprocessar o mesmo CSV (a ANP republica o mesmo arquivo entre semanas).
 */
async function alreadyIngested(fileHash: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase
    .from("ingestion_runs")
    .select("id")
    .eq("file_hash", fileHash)
    .eq("status", "success")
    .limit(1);
  if (error) {
    logger.warn({ err: error.message }, "[anpIngestor] Falha ao checar hash prévio; seguindo com a ingestão");
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Recupera os validadores HTTP (etag/last-modified) da última ingestão bem-sucedida,
 * para enviar como GET condicional (H2) e evitar rebaixar o CSV se nada mudou.
 */
async function lastCachingValidators(source: string): Promise<CachingValidators> {
  if (!supabase) return { etag: null, lastModified: null };
  const { data, error } = await supabase
    .from("ingestion_runs")
    .select("etag,last_modified")
    .eq("source", source)
    .eq("status", "success")
    .order("started_at", { ascending: false })
    .limit(1);
  if (error || !data?.length) return { etag: null, lastModified: null };
  return {
    etag: (data[0].etag as string) ?? null,
    lastModified: (data[0].last_modified as string) ?? null,
  };
}

/** Cria o registro de execução (status 'running') e retorna seu id. */
async function openRun(source: string, fileName: string): Promise<number | undefined> {
  if (!supabase) return undefined;
  const { data, error } = await supabase
    .from("ingestion_runs")
    .insert({ source, file_name: fileName, status: "running" })
    .select("id")
    .single();
  if (error) {
    logger.warn({ err: error.message }, "[anpIngestor] Falha ao abrir ingestion_run");
    return undefined;
  }
  return data?.id as number;
}

/** Fecha o registro de execução com o resultado final. */
async function closeRun(
  runId: number | undefined,
  patch: Record<string, unknown>
): Promise<void> {
  if (!supabase || runId == null) return;
  const { error } = await supabase.from("ingestion_runs").update(patch).eq("id", runId);
  if (error) {
    logger.warn({ err: error.message, runId }, "[anpIngestor] Falha ao fechar ingestion_run");
  }
}

/**
 * Ingere **um** arquivo CSV da ANP. Nunca lança: encapsula o erro no
 * `ingestion_runs` e no `IngestResult` (job em background não deve derrubar o processo).
 */
async function ingestOneFile(url: string, baseSource = "anp-shpc"): Promise<IngestResult> {
  const start = Date.now();
  // Nome do CSV (ex.: "precos-gasolina-etanol-12.csv") para o registro/observabilidade.
  const fileName = url.match(/([^/]+\.csv)/i)?.[1] ?? url.split("/").pop() ?? url;
  // Fonte por-arquivo → validadores condicionais (etag/last-modified) e histórico
  // de ingestão ficam corretos por arquivo, não misturados entre meses/grupos.
  const source = `${baseSource}:${fileName}`;

  if (!supabase) {
    const message = "Supabase não configurado — ingestão da ANP ignorada.";
    logger.warn(`[anpIngestor] ${message}`);
    return { status: "error", rowsRead: 0, rowsUpserted: 0, rowsRejected: 0, durationMs: Date.now() - start, message };
  }

  const runId = await openRun(source, fileName);

  try {
    // H2 — GET condicional: se o arquivo não mudou desde a última ingestão, o
    // servidor responde 304 e nem baixamos o corpo.
    const validators = await lastCachingValidators(source);
    logger.info({ url, conditional: !!(validators.etag || validators.lastModified) }, "[anpIngestor] Baixando CSV da ANP");
    const response = await fetchConditional(url, {
      etag: validators.etag,
      lastModified: validators.lastModified,
    });

    if (response.notModified) {
      const durationMs = Date.now() - start;
      await closeRun(runId, {
        status: "skipped",
        etag: response.etag ?? validators.etag,
        last_modified: response.lastModified ?? validators.lastModified,
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
      });
      logger.info("[anpIngestor] 304 Not Modified — nada a ingerir");
      return { status: "skipped", runId, rowsRead: 0, rowsUpserted: 0, rowsRejected: 0, durationMs };
    }

    const csv = (response.body as Buffer).toString("latin1");
    const fileHash = hashContent(csv);

    // 2ª linha de defesa (servidor sem suporte a condicional): pula por hash de conteúdo.
    if (await alreadyIngested(fileHash)) {
      const durationMs = Date.now() - start;
      await closeRun(runId, {
        status: "skipped",
        file_hash: fileHash,
        etag: response.etag,
        last_modified: response.lastModified,
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
      });
      logger.info({ fileHash }, "[anpIngestor] Conteúdo idêntico já ingerido — pulando");
      return { status: "skipped", runId, rowsRead: 0, rowsUpserted: 0, rowsRejected: 0, fileHash, durationMs };
    }

    const parsed = parseAnpCsv(csv);
    const { rows: normalized, stats } = normalizeFuelRows(parsed);
    const { rows: deduped, removed } = dedupeFuelRows(normalized);

    // H4 — gate final Zod (defense-in-depth). Barrados somam ao total rejeitado.
    const { valid, invalid, sampleIssues } = filterValidRows(deduped);
    const totalRejected = stats.rejected + invalid;

    logger.info(
      {
        read: stats.read,
        kept: stats.kept,
        normalizeRejected: stats.rejected,
        reasons: stats.rejectedReasons,
        deduped: removed,
        schemaRejected: invalid,
        schemaIssues: sampleIssues,
      },
      "[anpIngestor] Normalização + validação concluídas"
    );

    const { upserted } = await upsertFuelPrices(valid);
    const durationMs = Date.now() - start;

    await closeRun(runId, {
      status: "success",
      file_hash: fileHash,
      etag: response.etag,
      last_modified: response.lastModified,
      rows_read: stats.read,
      rows_inserted: upserted,
      rows_rejected: totalRejected,
      finished_at: new Date().toISOString(),
      duration_ms: durationMs,
    });

    logger.info({ runId, upserted, durationMs }, "[anpIngestor] Ingestão concluída");
    return {
      status: "success",
      runId,
      rowsRead: stats.read,
      rowsUpserted: upserted,
      rowsRejected: totalRejected,
      fileHash,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    await closeRun(runId, {
      status: "error",
      error: message,
      finished_at: new Date().toISOString(),
      duration_ms: durationMs,
    });
    logger.error({ err: message, runId }, "[anpIngestor] Ingestão falhou");
    return { status: "error", runId, rowsRead: 0, rowsUpserted: 0, rowsRejected: 0, durationMs, message };
  }
}

/**
 * Ingestão da ANP: baixa e processa **todos** os arquivos-alvo (por padrão, os
 * CSVs mensais de gasolina-etanol + diesel-gnv definidos por `ANP_YEAR`/`ANP_MONTHS`).
 *
 * - `options.url`  → ingere só aquele arquivo (usado pelo `--url` do script).
 * - `options.urls` → ingere essa lista explícita.
 * - sem nenhum     → usa `buildAnpUrls()` (env, com fallback sensato).
 *
 * Cada arquivo é idempotente e independente: um 404/erro num arquivo é registrado e
 * **pulado**, sem abortar os demais. O resultado agregado soma as contagens e só é
 * `error` se **todos** os arquivos falharam.
 */
export async function ingestAnp(options: IngestOptions = {}): Promise<IngestResult> {
  const start = Date.now();
  const urls = options.url ? [options.url] : options.urls ?? buildAnpUrls();

  logger.info({ files: urls.length }, "[anpIngestor] Iniciando ingestão da ANP (lote de arquivos)");

  let rowsRead = 0;
  let rowsUpserted = 0;
  let rowsRejected = 0;
  let anySuccess = false;
  let anySkipped = false;
  const failures: string[] = [];

  for (const url of urls) {
    const r = await ingestOneFile(url, options.source);
    rowsRead += r.rowsRead;
    rowsUpserted += r.rowsUpserted;
    rowsRejected += r.rowsRejected;
    if (r.status === "success") anySuccess = true;
    else if (r.status === "skipped") anySkipped = true;
    else failures.push(`${url.match(/([^/]+\.csv)/i)?.[1] ?? url}: ${r.message ?? "erro"}`);
  }

  const durationMs = Date.now() - start;
  const status: IngestResult["status"] = anySuccess ? "success" : anySkipped ? "skipped" : "error";
  const message =
    failures.length > 0
      ? `${failures.length}/${urls.length} arquivo(s) falharam. ${failures.slice(0, 4).join(" · ")}`
      : undefined;

  logger.info(
    { status, files: urls.length, rowsRead, rowsUpserted, rowsRejected, failures: failures.length, durationMs },
    "[anpIngestor] Lote de ingestão finalizado"
  );

  return { status, rowsRead, rowsUpserted, rowsRejected, durationMs, message };
}
