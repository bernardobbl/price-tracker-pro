import "dotenv/config";
import { supabase } from "../src/config/supabaseClient";
import { parseRetentionMonths } from "../src/services/retentionService";

/**
 * `npm run db:stats` — saúde do banco no free tier do Supabase (500 MB).
 * Mostra tamanho, linhas e janela de datas do `fuel_prices`, o % de uso do
 * limite grátis e a política de retenção em vigor. Use após ingestões para
 * acompanhar o crescimento e decidir se reduz `RETENTION_MONTHS`.
 */

const FREE_TIER_MB = 500;

async function main() {
  if (!supabase) {
    console.error("[db] Supabase não configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env).");
    process.exit(1);
  }

  const { data, error } = await supabase.rpc("fuel_db_stats");
  if (error) {
    console.error(`[db] Erro: ${error.message}`);
    console.error("[db] Dica: rode o backend/supabase/schema.sql atualizado no SQL Editor (cria fuel_db_stats).");
    process.exit(1);
  }

  const row = (Array.isArray(data) ? data[0] : data) as {
    db_size_mb: number | string;
    fuel_rows: number | string;
    oldest: string | null;
    newest: string | null;
  };

  const sizeMb = Number(row.db_size_mb);
  const pct = (sizeMb / FREE_TIER_MB) * 100;
  const months = parseRetentionMonths(process.env.RETENTION_MONTHS);

  console.log(`[db] Tamanho do banco: ${sizeMb} MB de ${FREE_TIER_MB} MB grátis (${pct.toFixed(1)}%)`);
  console.log(`[db] fuel_prices: ${row.fuel_rows} linhas · ${row.oldest ?? "—"} → ${row.newest ?? "—"}`);
  console.log(
    `[db] Retenção: ${months === 0 ? "DESLIGADA (RETENTION_MONTHS=0)" : `${months} meses (automática após cada ingestão)`}`
  );

  if (pct > 70) {
    console.log(`[db] ⚠️ Acima de 70% do free tier — reduza RETENTION_MONTHS (ex.: 12) no .env/host.`);
  } else {
    console.log(`[db] ✓ Uso confortável do free tier.`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[db] Falha inesperada:", err);
  process.exit(1);
});
