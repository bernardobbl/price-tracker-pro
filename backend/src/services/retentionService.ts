/**
 * Retenção automática do `fuel_prices` (Fase 9 — operação no free tier).
 *
 * O job semanal só ADICIONA linhas (~70k/mês); sem retenção o banco cresceria até
 * estourar os 500 MB do free tier do Supabase. Após cada ingestão, apagamos os
 * levantamentos mais antigos que `RETENTION_MONTHS` (padrão **12**) via RPC
 * `fuel_prices_retention` — o tamanho do banco atinge um platô e o custo fica
 * em R$ 0 para sempre. `RETENTION_MONTHS=0` desliga (banco cresce sem limite).
 *
 * Padrão calibrado com MEDIÇÃO real (25/jul/2026): 9 meses de dados = 209,9 MB
 * (~21–23 MB/mês). Janela de 18 meses daria ~420 MB (84% do limite — apertado);
 * **12 meses** dá um platô de ~280 MB (~56%) — folga permanente. 12 meses de
 * histórico cobre tudo o que a UI oferece (filtros de 30d a "tudo").
 */

import { supabase } from "../config/supabaseClient";
import { logger } from "../lib/logger";

export const DEFAULT_RETENTION_MONTHS = 12;

/**
 * Meses de retenção configurados. Puro (recebe o valor cru do env) e testável.
 * Regras: ausente/inválido → padrão (proteção ligada); "0" explícito → desligado.
 */
export function parseRetentionMonths(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_RETENTION_MONTHS;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 0) return DEFAULT_RETENTION_MONTHS;
  return n;
}

/**
 * Aplica a retenção (se ligada). Retorna o nº de linhas apagadas.
 * Nunca lança — falha de retenção não deve derrubar o job de ingestão.
 */
export async function applyRetention(): Promise<number> {
  const months = parseRetentionMonths(process.env.RETENTION_MONTHS);
  if (!supabase || months === 0) {
    if (months === 0) logger.info("[retention] RETENTION_MONTHS=0 — retenção desligada");
    return 0;
  }

  const { data, error } = await supabase.rpc("fuel_prices_retention", {
    p_keep_months: months,
  });

  if (error) {
    logger.error(
      { err: error.message, months },
      "[retention] Falha ao aplicar retenção (o schema.sql atualizado foi executado no Supabase?)"
    );
    return 0;
  }

  const deleted = Number(data ?? 0);
  if (deleted > 0) {
    logger.info({ months, deleted }, "[retention] Levantamentos antigos removidos");
  } else {
    logger.info({ months }, "[retention] Nada a remover (histórico dentro da janela)");
  }
  return deleted;
}
