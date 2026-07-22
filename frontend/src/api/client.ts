import type { PriceHistoryItem, TrackedProduct } from "../types";
import { supabase } from "../supabaseClient";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

async function getAuthHeaders(): Promise<Record<string, string>> {
  if (!supabase) {
    return {};
  }

  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return {};
  }

  return {
    Authorization: `Bearer ${session.access_token}`
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

export interface SearchResultItem {
  title: string;
  url: string;
}

export async function fetchProducts(): Promise<TrackedProduct[]> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/api/products`, {
    headers
  });

  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao buscar produtos rastreados"));
  }

  return response.json();
}

export async function searchProducts(q: string): Promise<SearchResultItem[]> {
  const response = await fetch(`${API_BASE_URL}/api/search?q=${encodeURIComponent(q)}`);

  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao buscar produtos"));
  }

  return response.json();
}

export interface CreateProductPayload {
  id: string;
  name: string;
  searchQuery: string;
  marketplace?: string;
}

export async function createProduct(payload: CreateProductPayload): Promise<TrackedProduct> {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/api/products`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao cadastrar produto"));
  }

  return response.json();
}

export async function fetchPriceHistory(productId: string): Promise<PriceHistoryItem[]> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/api/prices/${encodeURIComponent(productId)}`, {
    headers
  });

  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao buscar histórico de preços"));
  }

  return response.json();
}

export async function trackPriceNow(productId: string): Promise<PriceHistoryItem> {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `${API_BASE_URL}/api/track/${encodeURIComponent(productId)}`,
    {
      method: "POST",
      headers
    }
  );

  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao rastrear preço agora"));
  }

  return response.json();
}

export interface CreateAlertPayload {
  productId: string;
  thresholdPrice: number;
  currency?: string;
  channel?: string;
  enabled?: boolean;
  currentPrice?: number;
  productName?: string;
  productUrl?: string;
}

export async function createAlert(payload: CreateAlertPayload): Promise<unknown> {
  const authHeaders = await getAuthHeaders();

  if (!authHeaders.Authorization) {
    throw new Error("Sessão expirada. Faça login novamente.");
  }

  const response = await fetch(`${API_BASE_URL}/api/alerts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(await extractError(response, "Erro ao salvar alerta"));
  }

  return response.json();
}

