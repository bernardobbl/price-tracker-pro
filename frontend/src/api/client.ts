import type { PriceHistoryItem, TrackedProduct } from "../types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

export async function fetchProducts(): Promise<TrackedProduct[]> {
  const response = await fetch(`${API_BASE_URL}/api/products`);

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
  const response = await fetch(`${API_BASE_URL}/api/products`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
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
  const response = await fetch(`${API_BASE_URL}/api/prices/${encodeURIComponent(productId)}`);

  if (!response.ok) {
    throw new Error("Erro ao buscar histórico de preços");
  }

  return response.json();
}

export async function trackPriceNow(productId: string): Promise<PriceHistoryItem> {
  const response = await fetch(`${API_BASE_URL}/api/track/${encodeURIComponent(productId)}`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error("Erro ao rastrear preço agora");
  }

  return response.json();
}

