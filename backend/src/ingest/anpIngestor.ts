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
 * A ANP publica CSVs mensais; os meses-alvo são derivados da data de execução
 * (ver `buildAnpUrls`/`defaultAnpPeriods`), com override por env para backfill.
 */

import crypto from "crypto";
import { supabase } from "../config/supabaseClient";
import { logger } from "../lib/logger";
import { fetchBuffer, fetchConditional, ScrapeError } from "../scrapers/httpClient";
import { extractAnpFileLinks } from "./anpDiscovery";
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
 * Períodos (ano/mês) a ingerir por padrão: o mês corrente + os `count - 1`
 * anteriores, com virada de ano tratada. Puro e testável.
 *
 * Por que derivar da data em que o job RODA (e não de env fixo): o job é semanal
 * e vive por meses em produção — um mês "pinado" no env congelaria o dado para
 * sempre (o hash pularia os mesmos arquivos toda semana e o app exibiria preços
 * antigos eternamente). O mês corrente pode ainda não estar publicado → 404,
 * que o lote já pula sem abortar.
 */
export function defaultAnpPeriods(
  now: Date = new Date(),
  count = 3
): Array<{ year: string; month: string }> {
  const periods: Array<{ year: string; month: string }> = [];
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let i = 0; i < count; i++) {
    periods.push({
      year: String(cursor.getUTCFullYear()),
      month: String(cursor.getUTCMonth() + 1).padStart(2, "0"),
    });
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  return periods.reverse(); // cronológico: do mais antigo ao mais novo
}

/**
 * Períodos-alvo (ano/mês) da ingestão.
 * Padrão (sem env): **derivado da data atual** — mês corrente + 2 anteriores
 * (`defaultAnpPeriods`), então o job semanal acompanha o calendário sozinho.
 * Override: `ANP_YEAR` / `ANP_MONTHS` pinam ano e/ou meses (backfill/debug).
 */
export function targetAnpPeriods(now: Date = new Date()): Array<{ year: string; month: string }> {
  const envYear = process.env.ANP_YEAR?.trim();
  const envMonths = process.env.ANP_MONTHS?.trim();

  if (envYear || envMonths) {
    // Modo pinado: ano do env (ou o corrente) × meses do env (ou os recentes).
    const year = envYear || String(now.getUTCFullYear());
    const months = (envMonths || defaultAnpPeriods(now).map((p) => p.month).join(","))
      .split(",")
      .map((m) => m.trim().padStart(2, "0"))
      .filter((m) => /^\d{2}$/.test(m));
    return months.map((month) => ({ year, month }));
  }
  return defaultAnpPeriods(now);
}

/**
 * FALLBACK por padrão de nome (estilo 2025: `precos-{grupo}-MM.csv`). Usado só
 * quando a listagem da pasta do ano não pôde ser baixada — a fonte primária de
 * URLs é a descoberta (`resolveAnpUrls`), porque a ANP mudou o naming em 2026
 * de forma imprevisível (ver `anpDiscovery.ts`).
 */
export function buildAnpUrls(now: Date = new Date()): string[] {
  const single = process.env.ANP_CSV_URL?.trim();
  if (single) return [single];

  const urls: string[] = [];
  for (const { year, month } of targetAnpPeriods(now)) {
    for (const group of ANP_GROUPS) {
      urls.push(`${ANP_BASE}/${year}/precos-${group}-${month}.csv`);
    }
  }
  return urls;
}

/**
 * Resolve as URLs reais a ingerir **descobrindo os arquivos na listagem da pasta
 * do ano** (`.../dsan/ANO`), em vez de adivinhar o nome. Motivo: em 2026 a ANP
 * trocou o padrão de nome dos arquivos — com typo num deles e um sem extensão —
 * então nenhum template de URL é confiável (ver doc do `anpDiscovery.ts`).
 *
 * Comportamento:
 *  - `ANP_CSV_URL` explícito → só ele (sem descoberta);
 *  - mês-alvo ausente da listagem → **não publicado ainda**: é pulado sem nem
 *    tentar o download (zero 404);
 *  - listagem indisponível (rede/mudança de layout) → fallback para o padrão de
 *    nome de 2025 (`buildAnpUrls`), onde o 404 é tratado como "skipped".
 */
export async function resolveAnpUrls(now: Date = new Date()): Promise<string[]> {
  const single = process.env.ANP_CSV_URL?.trim();
  if (single) return [single];

  const periods = targetAnpPeriods(now);

  // Agrupa meses por ano → uma busca de listagem por ano.
  const monthsByYear = new Map<string, string[]>();
  for (const { year, month } of periods) {
    const arr = monthsByYear.get(year);
    if (arr) arr.push(month);
    else monthsByYear.set(year, [month]);
  }

  const urls: string[] = [];
  for (const [year, months] of monthsByYear) {
    let links: ReturnType<typeof extractAnpFileLinks> | null = null;
    try {
      const html = (await fetchBuffer(`${ANP_BASE}/${year}`, { timeoutMs: 15_000 })).toString("utf8");
      links = extractAnpFileLinks(html, year);
      logger.info({ year, found: links.length }, "[anpIngestor] Listagem da pasta do ano lida");
    } catch (err) {
      logger.warn(
        { year, err: err instanceof Error ? err.message : String(err) },
        "[anpIngestor] Falha ao ler a listagem do ano — usando padrão de nome como fallback"
      );
    }

    for (const month of months) {
      for (const group of ANP_GROUPS) {
        if (links) {
          const found = links.find((l) => l.month === month && l.group === group);
          if (found) {
            urls.push(found.url);
          } else {
            logger.info(
              { year, month, group },
              "[anpIngestor] Arquivo ausente da listagem (mês ainda não publicado) — pulando"
            );
          }
        } else {
          urls.push(`${ANP_BASE}/${year}/precos-${group}-${month}.csv`);
        }
      }
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

    // 404 = arquivo (ainda) não publicado — esperado no caminho de fallback
    // quando um mês não saiu. É "skipped", não erro: não deve derrubar o lote
    // nem fazer o CLI sair com exit 1.
    if (err instanceof ScrapeError && err.httpStatus === 404) {
      await closeRun(runId, {
        status: "skipped",
        error: "HTTP 404 — arquivo ainda não publicado",
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
      });
      logger.info({ url, runId }, "[anpIngestor] 404 (mês não publicado) — pulando");
      return { status: "skipped", runId, rowsRead: 0, rowsUpserted: 0, rowsRejected: 0, durationMs, message };
    }

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
 * - sem nenhum     → usa `resolveAnpUrls()` (descoberta pela listagem do ano,
 *                    com fallback para o padrão de nome).
 *
 * Cada arquivo é idempotente e independente: um 404/erro num arquivo é registrado e
 * **pulado**, sem abortar os demais. O resultado agregado soma as contagens e só é
 * `error` se **todos** os arquivos falharam.
 */
export async function ingestAnp(options: IngestOptions = {}): Promise<IngestResult> {
  const start = Date.now();
  const urls = options.url ? [options.url] : options.urls ?? (await resolveAnpUrls());

  logger.info({ files: urls.length }, "[anpIngestor] Iniciando ingestão da ANP (lote de arquivos)");

  // Lista vazia = nenhum mês-alvo publicado ainda (descoberta não achou nada).
  // Não é erro — é "nada a fazer nesta rodada".
  if (urls.length === 0) {
    return {
      status: "skipped",
      rowsRead: 0,
      rowsUpserted: 0,
      rowsRejected: 0,
      durationMs: Date.now() - start,
      message: "Nenhum arquivo-alvo publicado na listagem da ANP nesta rodada.",
    };
  }

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
