/**
 * Consulta dos preços de combustível (domínio ANP) sobre a tabela pública
 * `fuel_prices`. É a camada que o produto usa: listar produtos/locais disponíveis,
 * a série temporal do município (média/mín/máx por data) e o snapshot mais recente
 * com o ranking de postos.
 *
 * A agregação da série roda **no Postgres** (RPC `fuel_daily_series`) — o PostgREST
 * corta respostas em 1000 linhas mesmo com `.limit()` maior, então puxar as linhas
 * cruas do município truncaria silenciosamente os registros mais recentes conforme o
 * histórico cresce. O snapshot busca só as linhas do último levantamento (RPC
 * `fuel_latest_snapshot`, poucas dezenas) e delega o ranking/dedup à função pura
 * `summarizeSnapshot` (testada).
 */

import { supabase } from "../config/supabaseClient";
import { logger } from "../lib/logger";
import {
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

/** Linha devolvida pela RPC `fuel_daily_series` (agregação no Postgres). */
interface DailySeriesRow {
  date: string;
  avg_price: number | string;
  min_price: number | string;
  max_price: number | string;
  sample_size: number;
}

/** Linha (por posto) devolvida pela RPC `fuel_latest_snapshot`. */
interface SnapshotRow {
  collected_at: string;
  sell_price: number | string;
  reseller: string | null;
  brand: string | null;
  cnpj: string | null;
  street: string | null;
  street_number: string | null;
  neighborhood: string | null;
  cep: string | null;
}

function mapSnapshotRow(row: SnapshotRow): FuelPriceRecord {
  return {
    collectedAt: row.collected_at,
    sellPrice: Number(row.sell_price),
    reseller: row.reseller ?? "",
    brand: row.brand ?? null,
    cnpj: row.cnpj ?? "",
    street: row.street,
    streetNumber: row.street_number,
    neighborhood: row.neighborhood,
    cep: row.cep,
  };
}

/**
 * Série temporal agregada (média/mín/máx por data) de um produto num município.
 * A agregação roda no Postgres (`fuel_daily_series`): devolve uma linha por data
 * de levantamento (~semanal), imune ao teto de 1000 linhas do PostgREST.
 */
export async function getFuelSeries(
  product: string,
  state: string,
  municipality: string,
  brand?: string | null
): Promise<DailyAggregate[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("fuel_daily_series", {
    p_product: product,
    p_state: state,
    p_municipality: municipality,
    p_brand: brand ?? null,
  });

  if (error) {
    logger.error({ err: error.message }, "[fuelQuery] Erro ao buscar série agregada");
    return [];
  }

  return ((data ?? []) as DailySeriesRow[]).map((row) => ({
    date: row.date,
    avgPrice: Number(row.avg_price),
    minPrice: Number(row.min_price),
    maxPrice: Number(row.max_price),
    sampleSize: row.sample_size,
  }));
}

/**
 * Snapshot do levantamento mais recente + ranking de postos (I2). O banco devolve
 * só as linhas da data mais nova (`fuel_latest_snapshot`); o ranking/dedup por
 * CNPJ fica na função pura `summarizeSnapshot`.
 */
export async function getSnapshot(
  product: string,
  state: string,
  municipality: string,
  brand?: string | null
): Promise<SnapshotSummary> {
  if (!supabase) return summarizeSnapshot([]);
  const { data, error } = await supabase.rpc("fuel_latest_snapshot", {
    p_product: product,
    p_state: state,
    p_municipality: municipality,
    p_brand: brand ?? null,
  });

  if (error) {
    logger.error({ err: error.message }, "[fuelQuery] Erro ao buscar snapshot");
    return summarizeSnapshot([]);
  }

  return summarizeSnapshot(((data ?? []) as SnapshotRow[]).map(mapSnapshotRow));
}
