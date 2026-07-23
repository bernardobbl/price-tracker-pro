/**
 * Persistência dos preços de combustível da ANP no Supabase.
 *
 * A tabela `fuel_prices` é referência **pública** (sem user_id): o backend escreve
 * com a chave `service_role` (ignora RLS). A escrita é um **upsert idempotente**
 * pela chave natural (cnpj, product, collected_at), então reprocessar o mesmo
 * arquivo não gera linhas duplicadas.
 */

import { supabase } from "../config/supabaseClient";
import { logger } from "../lib/logger";
import type { NormalizedFuelRow } from "../ingest/anpNormalize";

/** Chunk de upsert — evita payloads gigantes numa única requisição. */
const UPSERT_CHUNK = 500;

/** Conflito resolvido pela chave natural (precisa casar com o UNIQUE do schema). */
const ON_CONFLICT = "cnpj,product,collected_at";

/** Converte a linha normalizada (camelCase) para a coluna do banco (snake_case). */
function toRecord(row: NormalizedFuelRow) {
  return {
    region: row.region || null,
    state: row.state,
    municipality: row.municipality,
    reseller: row.reseller || null,
    cnpj: row.cnpj,
    product: row.product,
    collected_at: row.collectedAt,
    sell_price: row.sellPrice,
    buy_price: row.buyPrice,
    unit: row.unit || null,
    brand: row.brand || null,
  };
}

export interface UpsertResult {
  /** Linhas enviadas ao banco (inseridas ou atualizadas). */
  upserted: number;
}

/**
 * Faz upsert das linhas em `fuel_prices` em lotes. Idempotente pela chave natural.
 * Lança se o Supabase não estiver configurado (o ETL exige persistência real) ou
 * se algum lote falhar — o chamador (ingestor) registra o erro no `ingestion_runs`.
 */
export async function upsertFuelPrices(rows: NormalizedFuelRow[]): Promise<UpsertResult> {
  if (!supabase) {
    throw new Error("Supabase não configurado — impossível persistir fuel_prices.");
  }
  if (rows.length === 0) return { upserted: 0 };

  let upserted = 0;

  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK).map(toRecord);

    const { error } = await supabase
      .from("fuel_prices")
      .upsert(chunk, { onConflict: ON_CONFLICT, ignoreDuplicates: false });

    if (error) {
      logger.error({ err: error.message, from: i, size: chunk.length }, "[fuel_prices] Falha no upsert do lote");
      throw new Error(`Upsert de fuel_prices falhou no lote ${i}: ${error.message}`);
    }

    upserted += chunk.length;
  }

  logger.info({ upserted }, "[fuel_prices] Upsert concluído");
  return { upserted };
}
