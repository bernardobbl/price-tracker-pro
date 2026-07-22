import { supabase } from "../config/supabaseClient";
import { logger } from "../lib/logger";

export interface CreateProductInput {
  id: string;
  name: string;
  searchQuery: string;
  marketplace?: "mercado-livre";
  userId?: string;
}

// Representa um produto salvo no banco (sem dados de preço)
export interface StoredProduct {
  id: string;
  name: string;
  searchQuery: string;
  marketplace: "mercado-livre";
  user_id?: string;
}

// 🔹 Fallback em memória (caso Supabase esteja ausente)
const FALLBACK_PRODUCTS: StoredProduct[] = [
  {
    id: "ps5",
    name: "PlayStation 5",
    searchQuery: "PlayStation 5",
    marketplace: "mercado-livre"
  }
];

// 🔹 Função auxiliar para converter dados do Supabase
function mapRowToProduct(row: {
  id: string;
  name: string;
  search_query: string;
  marketplace: string;
  user_id?: string;
}): StoredProduct {
  return {
    id: row.id,
    name: row.name,
    searchQuery: row.search_query,
    marketplace: row.marketplace as "mercado-livre",
    user_id: row.user_id
  };
}

/**
 * Lista todos os produtos rastreados do usuário
 */
export async function listProducts(userId?: string | null): Promise<StoredProduct[]> {
  if (!supabase) {
    return FALLBACK_PRODUCTS;
  }

  const query = supabase
    .from("tracked_products")
    .select("id, name, search_query, marketplace, user_id")
    .order("created_at", { ascending: true });

  const { data, error } = await (userId ? query.eq("user_id", userId) : query);

  if (error) {
    logger.error({ err: error.message }, "[Supabase] Erro ao listar produtos");
    return FALLBACK_PRODUCTS;
  }

  if (!data) return [];

  return data.map(mapRowToProduct);
}

/**
 * Busca um produto específico por ID (filtrado por usuário)
 */
export async function getProductById(
  id: string,
  userId?: string | null
): Promise<StoredProduct | null> {
  if (!supabase) {
    const found = FALLBACK_PRODUCTS.find((p) => p.id === id);
    return found ?? null;
  }

  let query = supabase
    .from("tracked_products")
    .select("id, name, search_query, marketplace, user_id")
    .eq("id", id);

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    logger.error({ err: error.message }, "[Supabase] Erro ao buscar produto");
    return null;
  }

  if (!data) return null;

  return mapRowToProduct(data);
}

/**
 * Cria um novo produto rastreável
 */
export async function createProduct(input: CreateProductInput): Promise<StoredProduct> {
  const marketplace: "mercado-livre" = input.marketplace ?? "mercado-livre";

  if (!supabase) {
    const product: StoredProduct = {
      id: input.id,
      name: input.name,
      searchQuery: input.searchQuery,
      marketplace
    };

    const exists = FALLBACK_PRODUCTS.some((p) => p.id === product.id);
    if (!exists) FALLBACK_PRODUCTS.push(product);
    return product;
  }

  const { data, error } = await supabase
    .from("tracked_products")
    .insert({
      id: input.id,
      name: input.name,
      search_query: input.searchQuery,
      marketplace,
      user_id: input.userId
    })
    .select("id, name, search_query, marketplace, user_id")
    .maybeSingle();

  if (error) {
    logger.error({ err: error.message }, "[Supabase] Erro ao criar produto");
    throw new Error("Erro ao cadastrar produto para rastreamento");
  }

  if (!data) {
    throw new Error("Resposta inesperada ao criar produto");
  }

  return mapRowToProduct(data);
}