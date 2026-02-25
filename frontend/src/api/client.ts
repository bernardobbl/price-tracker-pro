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

export async function fetchProducts(): Promise<TrackedProduct[]> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/api/products`, {
    headers
  });

  if (!response.ok) {
    throw new Error("Erro ao buscar produtos rastreados");
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
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.error ?? "Erro ao cadastrar produto");
  }

  return response.json();
}

export async function fetchPriceHistory(productId: string): Promise<PriceHistoryItem[]> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/api/prices/${encodeURIComponent(productId)}`, {
    headers
  });

  if (!response.ok) {
    throw new Error("Erro ao buscar histórico de preços");
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
    throw new Error("Erro ao rastrear preço agora");
  }

  return response.json();
}

