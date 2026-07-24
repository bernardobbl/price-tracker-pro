import "dotenv/config";
import { supabase } from "../src/config/supabaseClient";
import { ingestAnp } from "../src/ingest/anpIngestor";
import { evaluateAllFuelAlerts } from "../src/services/fuelAlertService";

/**
 * Ingestão manual do arquivo real da ANP (Série Histórica de Preços de Combustíveis).
 *
 * É o mesmo caminho do job semanal (`scheduleWeeklyAnpJob`), mas disparado sob demanda
 * pela linha de comando — útil para a **1ª carga** (popular o banco antes do deploy),
 * para reprocessar após trocar o semestre, ou para depurar a ingestão sem subir o servidor.
 *
 * Baixa o CSV (com GET condicional/timeout/retry), parseia → normaliza → deduplica →
 * valida (Zod) → faz upsert idempotente em `fuel_prices`, registra em `ingestion_runs`
 * e, se entrou dado novo, reavalia os alertas. Ao final, imprime um resumo do banco.
 *
 * Uso:
 *   npm run ingest                       # usa ANP_CSV_URL do .env (ou o padrão do semestre)
 *   npm run ingest -- --url <URL_DO_CSV> # força uma URL específica (ex.: outro semestre)
 *
 * Requer SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY no .env (o ETL grava via service_role).
 */

function parseUrlArg(): string | undefined {
  const i = process.argv.indexOf("--url");
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return undefined;
}

async function printDbSummary(): Promise<void> {
  if (!supabase) return;
  const { count } = await supabase
    .from("fuel_prices")
    .select("*", { count: "exact", head: true });
  const { data: states } = await supabase.rpc("fuel_states");
  console.log(
    `[ingest] Banco agora: ${count ?? "?"} linhas em fuel_prices · ` +
      `${Array.isArray(states) ? states.length : 0} UFs com dados`
  );
}

async function main() {
  if (!supabase) {
    console.error(
      "[ingest] Supabase não configurado. Preencha SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env."
    );
    process.exit(1);
  }

  const url = parseUrlArg();
  console.log(`[ingest] Iniciando ingestão da ANP${url ? ` (URL forçada)` : ""}…`);

  const result = await ingestAnp(url ? { url } : {});

  console.log(
    `[ingest] Status: ${result.status} · lidas: ${result.rowsRead} · ` +
      `upsert: ${result.rowsUpserted} · rejeitadas: ${result.rowsRejected} · ${result.durationMs}ms`
  );
  if (result.message) console.log(`[ingest] Mensagem: ${result.message}`);

  if (result.status === "success") {
    const { evaluated, notified } = await evaluateAllFuelAlerts();
    console.log(`[ingest] Alertas reavaliados: ${evaluated} avaliados · ${notified} notificados`);
  }

  await printDbSummary();

  if (result.status === "error") {
    console.error("[ingest] Ingestão terminou em erro — veja a mensagem acima e a tabela ingestion_runs.");
    process.exit(1);
  }
  console.log("[ingest] Concluído.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[ingest] Falha inesperada:", err);
  process.exit(1);
});
