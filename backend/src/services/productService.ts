import { supabase } from "../config/supabaseClient";
import type { ProductToTrack } from "./priceService";

export interface CreateProductInput {
  id: string;
  name: string;
  searchQuery: string;
  marketplace?: "mercado-livre";
}

// Fallback em memória quando Supabase não está configurado
const FALLBACK_PRODUCTS: ProductToTrack[] = [
  {
    id: "ps5",
    name: "PlayStation 5",
    searchQuery: "PlayStation 5",
    marketplace: "mercado-livre"
  }
];

function mapRowToProduct(row: any): ProductToTrack {
  return {
    id: row.id,
    name: row.name,
    searchQuery: row.search_query,
    marketplace: row.marketplace as "mercado-livre"
  };
}

export async function listProducts(): Promise<ProductToTrack[]> {
  if (!supabase) {
    return FALLBACK_PRODUCTS;
  }

  const { data, error } = await supabase
    .from("tracked_products")
    .select("id, name, search_query, marketplace")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[Supabase] Erro ao listar produtos:", error.message);
    return FALLBACK_PRODUCTS;
  }

  if (!data) return [];

  return data.map(mapRowToProduct);
}

export async function getProductById(id: string): Promise<ProductToTrack | null> {
  if (!supabase) {
    const found = FALLBACK_PRODUCTS.find((p) => p.id === id);
    return found ?? null;
  }

  const { data, error } = await supabase
    .from("tracked_products")
    .select("id, name, search_query, marketplace")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[Supabase] Erro ao buscar produto:", error.message);
    return null;
  }

  if (!data) return null;

  return mapRowToProduct(data);
}

export async function createProduct(input: CreateProductInput): Promise<ProductToTrack> {
  const marketplace: "mercado-livre" = input.marketplace ?? "mercado-livre";

  if (!supabase) {
    const product: ProductToTrack = {
      id: input.id,
      name: input.name,
      searchQuery: input.searchQuery,
      marketplace
    };
    const exists = FALLBACK_PRODUCTS.some((p) => p.id === product.id);
    if (!exists) {
      FALLBACK_PRODUCTS.push(product);
    }
    return product;
  }

  const { data, error } = await supabase
    .from("tracked_products")
    .insert({
      id: input.id,
      name: input.name,
      search_query: input.searchQuery,
      marketplace
    })
    .select("id, name, search_query, marketplace")
    .maybeSingle();

  if (error) {
    console.error("[Supabase] Erro ao criar produto:", error.message);
    throw new Error("Erro ao cadastrar produto para rastreamento");
  }

  if (!data) {
    throw new Error("Resposta inesperada ao criar produto");
  }

  return mapRowToProduct(data);
}

