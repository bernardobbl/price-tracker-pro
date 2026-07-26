/**
 * Favoritos do usuário no domínio combustível (`tracked_series`).
 * Uma série = produto + UF + município (+ bandeira opcional). É o que o usuário
 * monitora e o alvo dos alertas. Por-usuário, protegido por RLS no banco.
 */

import { supabase } from "../config/supabaseClient";
import { logger } from "../lib/logger";
import { buildSeriesLabel } from "../lib/seriesLabel";

export interface CreateTrackedSeriesInput {
  userId: string;
  product: string;
  state: string;
  municipality: string;
  brand?: string | null;
  label?: string;
}

export interface TrackedSeries {
  id: string;
  product: string;
  state: string;
  municipality: string;
  brand: string | null;
  label: string;
  created_at?: string;
}

function mapRow(row: {
  id: string;
  product: string;
  state: string;
  municipality: string;
  brand: string | null;
  label: string;
  created_at?: string;
}): TrackedSeries {
  return {
    id: row.id,
    product: row.product,
    state: row.state,
    municipality: row.municipality,
    brand: row.brand,
    label: row.label,
    created_at: row.created_at,
  };
}

/**
 * Cria (ou retorna o existente) um favorito do usuário. Como o UNIQUE é sobre
 * uma expressão (`coalesce(brand,'')`), fazemos select-then-insert em vez de upsert.
 */
export async function createTrackedSeries(input: CreateTrackedSeriesInput): Promise<TrackedSeries> {
  if (!supabase) throw new Error("tracked_series requer Supabase configurado.");

  const product = input.product.toUpperCase();
  const state = input.state.toUpperCase();
  const municipality = input.municipality.toUpperCase();
  const brand = input.brand ? input.brand.toUpperCase() : null;
  const label = input.label?.trim() || buildSeriesLabel(product, state, municipality, brand);

  // Já existe essa combinação para o usuário?
  let existingQuery = supabase
    .from("tracked_series")
    .select("id, product, state, municipality, brand, label, created_at")
    .eq("user_id", input.userId)
    .eq("product", product)
    .eq("state", state)
    .eq("municipality", municipality);
  existingQuery = brand ? existingQuery.eq("brand", brand) : existingQuery.is("brand", null);

  const { data: existing, error: findError } = await existingQuery.maybeSingle();
  if (findError) {
    logger.error({ err: findError.message }, "[trackedSeries] Erro ao verificar favorito existente");
  }
  if (existing) return mapRow(existing);

  const { data, error } = await supabase
    .from("tracked_series")
    .insert({ user_id: input.userId, product, state, municipality, brand, label })
    .select("id, product, state, municipality, brand, label, created_at")
    .single();

  if (error || !data) {
    logger.error({ err: error?.message }, "[trackedSeries] Erro ao criar favorito");
    throw new Error("Erro ao salvar favorito de combustível");
  }
  return mapRow(data);
}

export async function listTrackedSeries(userId?: string | null): Promise<TrackedSeries[]> {
  if (!supabase || !userId) return [];
  const { data, error } = await supabase
    .from("tracked_series")
    .select("id, product, state, municipality, brand, label, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    logger.error({ err: error.message }, "[trackedSeries] Erro ao listar favoritos");
    return [];
  }
  return (data ?? []).map(mapRow);
}

/**
 * Busca um favorito **do usuário** pelo id; devolve `null` se não existir ou se
 * pertencer a outra pessoa.
 *
 * Por que existe: o backend usa a chave `service_role`, que **bypassa o RLS** —
 * então as políticas do banco não são a proteção efetiva nas rotas, e sim o filtro
 * explícito por `user_id`. Toda rota que recebe um `series_id` do cliente precisa
 * passar por aqui antes de usá-lo (ex.: criação de alerta).
 */
export async function getOwnedTrackedSeries(
  id: string,
  userId?: string | null
): Promise<TrackedSeries | null> {
  if (!supabase || !userId) return null;

  const { data, error } = await supabase
    .from("tracked_series")
    .select("id, product, state, municipality, brand, label, created_at")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    logger.error({ err: error.message }, "[trackedSeries] Erro ao verificar posse do favorito");
    return null;
  }
  return data ? mapRow(data) : null;
}

export async function deleteTrackedSeries(id: string, userId?: string | null): Promise<void> {
  if (!supabase || !userId) return;
  const { error } = await supabase
    .from("tracked_series")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    logger.error({ err: error.message }, "[trackedSeries] Erro ao excluir favorito");
    throw new Error("Erro ao excluir favorito");
  }
}
