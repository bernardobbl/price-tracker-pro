/**
 * Consulta dos preços de combustível (domínio ANP) sobre a tabela pública
 * `fuel_prices`. É a camada que o produto usa: listar produtos/locais disponíveis,
 * a série temporal do município (média/mín/máx por data) e o snapshot mais recente
 * com o ranking de postos. A agregação em si é pura (`lib/fuelAggregate`).
 */

import { supabase } from "../config/supabaseClient";
import { logger } from "../lib/logger";
import {
  aggregateDailySeries,
  summarizeSnapshot,
  type DailyAggregate,
  type FuelPriceRecord,
  type SnapshotSummary,
} from "../lib/fuelAggregate";

/**
 * Lista canônica de produtos (saída do `canonicalProduct`). É estável e pequena,
 * então serve de opções do seletor sem varrer a tabela inteira.
 */
export const FUEL_PRODUCTS = [
  "GASOLINA",
  "GASOLINA ADITIVADA",
  "ETANOL",
  "DIESEL",
  "DIESEL S10",
  "DIESEL S500",
  "GNV",
  "GLP",
] as const;

// Teto defensivo de linhas por consulta (o volume real por município é pequeno;
// evita puxar o país inteiro por engano). Para o dataset completo, o próximo passo
// seria uma view/RPC — registrado como melhoria futura.
const ROW_LIMIT = 20_000;

export function listProducts(): string[] {
  return [...FUEL_PRODUCTS];
}

/**
 * UFs que têm dados. Usa a função `fuel_states()` (DISTINCT no servidor) em vez de
 * puxar linhas e deduplicar no cliente — o PostgREST limita respostas a 1000 linhas,
 * então o distinct-no-cliente silenciosamente perdia UFs. A RPC devolve ~poucas
 * dezenas de linhas, bem abaixo do teto.
 */
export async function listStates(): Promise<string[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("fuel_states");
  if (error) {
    logger.error({ err: error.message }, "[fuelQuery] Erro ao listar UFs");
    return [];
  }
  const rows = (data ?? []) as Array<{ state: string | null }>;
  return rows.map((r) => r.state).filter((s): s is string => Boolean(s));
}

/** Municípios com dados numa UF (DISTINCT no servidor via `fuel_municipalities`). */
export async function listMunicipalities(state: string): Promise<string[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("fuel_municipalities", { p_state: state });
  if (error) {
    logger.error({ err: error.message }, "[fuelQuery] Erro ao listar municípios");
    return [];
  }
  const rows = (data ?? []) as Array<{ municipality: string | null }>;
  return rows.map((r) => r.municipality).filter((m): m is string => Boolean(m));
}

function mapRow(row: {
  collected_at: string;
  sell_price: number | string;
  reseller: string | null;
  brand: string | null;
  cnpj: string | null;
}): FuelPriceRecord {
  return {
    collectedAt: row.collected_at,
    sellPrice: Number(row.sell_price),
    reseller: row.reseller ?? "",
    brand: row.brand ?? null,
    cnpj: row.cnpj ?? "",
  };
}

async function fetchRecords(
  product: string,
  state: string,
  municipality: string,
  brand?: string | null
): Promise<FuelPriceRecord[]> {
  if (!supabase) return [];
  let query = supabase
    .from("fuel_prices")
    .select("collected_at, sell_price, reseller, brand, cnpj")
    .eq("product", product)
    .eq("state", state)
    .eq("municipality", municipality);

  // Filtro opcional de bandeira (série/alerta por bandeira específica).
  if (brand) query = query.eq("brand", brand);

  const { data, error } = await query
    .order("collected_at", { ascending: true })
    .limit(ROW_LIMIT);

  if (error) {
    logger.error({ err: error.message }, "[fuelQuery] Erro ao buscar registros de preço");
    return [];
  }
  return (data ?? []).map(mapRow);
}

/** Série temporal agregada (média/mín/máx por data) de um produto num município. */
export async function getFuelSeries(
  product: string,
  state: string,
  municipality: string,
  brand?: string | null
): Promise<DailyAggregate[]> {
  const records = await fetchRecords(product, state, municipality, brand);
  return aggregateDailySeries(records);
}

/** Snapshot do levantamento mais recente + ranking de postos (I2). */
export async function getSnapshot(
  product: string,
  state: string,
  municipality: string,
  brand?: string | null
): Promise<SnapshotSummary> {
  const records = await fetchRecords(product, state, municipality, brand);
  return summarizeSnapshot(records);
}
