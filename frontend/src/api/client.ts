import type {
  FuelAlert,
  FuelSeriesPoint,
  SnapshotSummary,
  TrackedSeries,
} from "../types";
import { supabase } from "../supabaseClient";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

async function getAuthHeaders(): Promise<Record<string, string>> {
  if (!supabase) {
    return {};
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return {};
  }

  return {
    Authorization: `Bearer ${session.access_token}`,
  };
}

/**
 * Extrai a mensagem de erro do corpo da resposta.
 * Suporta o formato padrão `{ error: { code, message } }`.
 */
async function extractError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  const err = body?.error;
  if (err && typeof err === "object" && typeof err.message === "string") return err.message;
  if (typeof err === "string") return err;
  return fallback;
}

// ── Consulta pública (dados da ANP) ─────────────────────────────────────────

/** Produtos canônicos disponíveis (gasolina, etanol, diesel…). */
export async function fetchFuelProducts(): Promise<string[]> {
  const response = await fetch(`${API_BASE_URL}/api/fuel/products`);
  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao carregar produtos"));
  }
  return response.json();
}

/** UFs que têm dados. */
export async function fetchStates(): Promise<string[]> {
  const response = await fetch(`${API_BASE_URL}/api/fuel/locations`);
  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao carregar estados"));
  }
  const body = (await response.json()) as { states?: string[] };
  return body.states ?? [];
}

/** Municípios com dados numa UF. */
export async function fetchMunicipalities(state: string): Promise<string[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/fuel/locations?state=${encodeURIComponent(state)}`
  );
  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao carregar municípios"));
  }
  const body = (await response.json()) as { municipalities?: string[] };
  return body.municipalities ?? [];
}

export interface SeriesQuery {
  product: string;
  state: string;
  municipality: string;
  brand?: string | null;
}

function seriesQueryString({ product, state, municipality, brand }: SeriesQuery): string {
  const params = new URLSearchParams({ product, state, municipality });
  if (brand) params.set("brand", brand);
  return params.toString();
}

/** Série temporal agregada (média/mín/máx por data). */
export async function fetchSeries(query: SeriesQuery): Promise<FuelSeriesPoint[]> {
  const response = await fetch(`${API_BASE_URL}/api/fuel/series?${seriesQueryString(query)}`);
  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao carregar a série de preços"));
  }
  return response.json();
}

/** Levantamento mais recente + ranking de postos ("onde está mais barato"). */
export async function fetchSnapshot(query: SeriesQuery): Promise<SnapshotSummary> {
  const response = await fetch(`${API_BASE_URL}/api/fuel/snapshot?${seriesQueryString(query)}`);
  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao carregar o levantamento mais recente"));
  }
  return response.json();
}

// ── Favoritos (tracked_series) ──────────────────────────────────────────────

export async function fetchTrackedSeries(): Promise<TrackedSeries[]> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/api/fuel/tracked`, { headers });
  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao carregar favoritos"));
  }
  return response.json();
}

export interface CreateTrackedSeriesPayload {
  product: string;
  state: string;
  municipality: string;
  brand?: string | null;
  label?: string;
}

export async function createTrackedSeries(
  payload: CreateTrackedSeriesPayload
): Promise<TrackedSeries> {
  const authHeaders = await getAuthHeaders();
  if (!authHeaders.Authorization) {
    throw new Error("Faça login para salvar favoritos.");
  }
  const response = await fetch(`${API_BASE_URL}/api/fuel/tracked`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao salvar favorito"));
  }
  return response.json();
}

export async function deleteTrackedSeries(id: string): Promise<void> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/api/fuel/tracked/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers,
  });
  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao excluir favorito"));
  }
}

// ── Alertas por série ───────────────────────────────────────────────────────

export async function fetchFuelAlerts(): Promise<FuelAlert[]> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/api/fuel/alerts`, { headers });
  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao carregar alertas"));
  }
  return response.json();
}

export interface CreateFuelAlertPayload {
  seriesId: string;
  thresholdPrice: number;
  currency?: string;
  channel?: "email";
  enabled?: boolean;
}

export async function createFuelAlert(payload: CreateFuelAlertPayload): Promise<FuelAlert> {
  const authHeaders = await getAuthHeaders();
  if (!authHeaders.Authorization) {
    throw new Error("Sessão expirada. Faça login novamente.");
  }
  const response = await fetch(`${API_BASE_URL}/api/fuel/alerts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao salvar alerta"));
  }
  return response.json();
}

export async function deleteFuelAlert(alertId: string): Promise<void> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/api/fuel/alerts/${encodeURIComponent(alertId)}`, {
    method: "DELETE",
    headers,
  });
  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao excluir alerta"));
  }
}
