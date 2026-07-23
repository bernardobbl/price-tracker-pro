import "dotenv/config";
import { supabase } from "../src/config/supabaseClient";
import { parseAnpCsv } from "../src/ingest/anpParser";
import { normalizeFuelRows, dedupeFuelRows } from "../src/ingest/anpNormalize";
import { filterValidRows } from "../src/ingest/anpRowSchema";
import { upsertFuelPrices } from "../src/services/fuelPriceService";
import { buildSeriesLabel } from "../src/lib/seriesLabel";
import { buildAnpCsv, CITIES, WEEKS } from "./lib/anpDemoData";

/**
 * Seed da demo (domínio combustível / ANP).
 *
 * Gera uma **amostra no formato SHPC da ANP** (mesmo layout do arquivo oficial:
 * separador `;`, decimal com vírgula, data dd/mm/aaaa) cobrindo várias semanas,
 * cidades, produtos e postos — e a ingere pelo **pipeline ETL real**
 * (`parseAnpCsv → normalizeFuelRows → dedupeFuelRows → filterValidRows → upsertFuelPrices`),
 * exatamente como o ingestor semanal faz com o arquivo público. Também cria um
 * usuário demo com 1 favorito (`tracked_series`) e 1 alerta, para o app abrir com conteúdo.
 *
 * ⚠️ Honestidade: os **preços** aqui são gerados (variação semanal simulada, mas em
 * níveis realistas de mercado) — é uma amostra de demonstração, não uma cópia do
 * arquivo oficial (que tem 100+ MB e não cabe no repo). Em produção, o job semanal
 * (`scheduleWeeklyAnpJob` / `ANP_INGEST_ON_BOOT=true`) ingere o **arquivo real da ANP**.
 * A estrutura, o parsing e a normalização são idênticos aos de produção.
 *
 * Uso: npm run seed  (requer SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY no .env)
 */

const DEMO_EMAIL = process.env.DEMO_EMAIL || "demo@pricetracker.pro";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "demo123456";

// ── Usuário demo + favorito + alerta ──────────────────────────────────────────

async function getOrCreateDemoUser(): Promise<string> {
  if (!supabase) throw new Error("Supabase não configurado.");

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
  });

  if (!createError && created?.user) {
    console.log(`[seed] Usuário demo criado: ${DEMO_EMAIL}`);
    return created.user.id;
  }

  const { data: list, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) throw listError;
  const existing = list.users.find((u) => u.email === DEMO_EMAIL);
  if (!existing) throw new Error(`Não foi possível criar nem encontrar o usuário demo (${DEMO_EMAIL}).`);

  console.log(`[seed] Usuário demo já existia: ${DEMO_EMAIL}`);
  return existing.id;
}

/** Cria um favorito + alerta de demo (idempotente) apontando para Gasolina/São Paulo. */
async function seedFavoriteAndAlert(userId: string): Promise<void> {
  if (!supabase) return;

  const product = "GASOLINA";
  const state = "SP";
  const municipality = "SAO PAULO";
  const label = buildSeriesLabel(product, state, municipality, null);

  // Favorito (select-then-insert: o UNIQUE é sobre uma expressão coalesce).
  const { data: existing } = await supabase
    .from("tracked_series")
    .select("id")
    .eq("user_id", userId)
    .eq("product", product)
    .eq("state", state)
    .eq("municipality", municipality)
    .is("brand", null)
    .maybeSingle();

  let seriesId = existing?.id as string | undefined;
  if (!seriesId) {
    const { data, error } = await supabase
      .from("tracked_series")
      .insert({ user_id: userId, product, state, municipality, brand: null, label })
      .select("id")
      .single();
    if (error) {
      console.error("[seed] Erro ao criar favorito demo:", error.message);
      return;
    }
    seriesId = data.id as string;
  }

  // Alerta (upsert na chave user+série+canal). Threshold abaixo do preço típico → fica pendente.
  const { error: alertError } = await supabase.from("alerts").upsert(
    {
      user_id: userId,
      series_id: seriesId,
      threshold_price: 5.5,
      currency: "R$",
      channel: "email",
      enabled: true,
    },
    { onConflict: "user_id,series_id,channel" }
  );
  if (alertError) console.error("[seed] Erro ao criar alerta demo:", alertError.message);
  else console.log(`[seed] Favorito + alerta demo prontos: ${label} (abaixo de R$ 5,500)`);
}

/** Registra a execução em ingestion_runs (paridade de observabilidade com o ETL real). */
async function recordRun(patch: Record<string, unknown>): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("ingestion_runs").insert({
    source: "seed-demo",
    file_name: "anpDemo (gerado)",
    status: "success",
    ...patch,
  });
  if (error) console.error("[seed] Erro ao registrar ingestion_run:", error.message);
}

async function main() {
  if (!supabase) {
    console.error("[seed] Supabase não configurado. Preencha SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.");
    process.exit(1);
  }

  const start = Date.now();
  const userId = await getOrCreateDemoUser();

  // ── ETL real sobre a amostra gerada ──
  const csv = buildAnpCsv();
  const parsed = parseAnpCsv(csv);
  const { rows: normalized, stats } = normalizeFuelRows(parsed);
  const { rows: deduped, removed } = dedupeFuelRows(normalized);
  const { valid, invalid } = filterValidRows(deduped);

  console.log(
    `[seed] ETL: ${stats.read} lidas · ${stats.kept} normalizadas · ${removed} dedup · ${invalid} barradas → ${valid.length} para upsert`
  );

  const { upserted } = await upsertFuelPrices(valid);
  console.log(`[seed] fuel_prices: ${upserted} linhas gravadas (${CITIES.length} cidades × ${WEEKS} semanas).`);

  await seedFavoriteAndAlert(userId);
  await recordRun({
    rows_read: stats.read,
    rows_inserted: upserted,
    rows_rejected: stats.rejected + invalid,
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - start,
  });

  console.log(`\n[seed] Concluído! Login demo → email: ${DEMO_EMAIL} | senha: ${DEMO_PASSWORD}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed] Falha:", err);
  process.exit(1);
});
