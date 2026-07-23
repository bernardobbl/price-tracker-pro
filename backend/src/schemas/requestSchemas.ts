import { z } from "zod";

export const createProductSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  searchQuery: z.string().min(1),
  marketplace: z.literal("books-to-scrape").optional(),
});

export const createAlertSchema = z.object({
  productId: z.string().min(1),
  thresholdPrice: z.number().positive("thresholdPrice deve ser um número positivo"),
  currency: z.string().optional(),
  channel: z.literal("email").optional(),
  enabled: z.boolean().optional(),
  currentPrice: z.number().optional(),
  productName: z.string().optional(),
  productUrl: z.string().url().optional(),
});

export const trackParamsSchema = z.object({
  productId: z.string().min(1),
});

export const productParamsSchema = z.object({
  productId: z.string().min(1),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1, "Parâmetro 'q' é obrigatório."),
});

// ── Domínio combustível (ANP) ───────────────────────────────────────────────

/** UF opcional para listar municípios (`GET /api/fuel/locations`). */
export const fuelLocationsQuerySchema = z.object({
  state: z.string().trim().length(2, "UF deve ter 2 letras.").optional(),
});

/** Produto + UF + município (+ bandeira opcional) para série/snapshot. */
export const fuelSeriesQuerySchema = z.object({
  product: z.string().trim().min(1, "Parâmetro 'product' é obrigatório."),
  state: z.string().trim().length(2, "UF deve ter 2 letras."),
  municipality: z.string().trim().min(1, "Parâmetro 'municipality' é obrigatório."),
  brand: z.string().trim().min(1).optional(),
});

/** Favorito do usuário (tracked_series). */
export const createTrackedSeriesSchema = z.object({
  product: z.string().trim().min(1),
  state: z.string().trim().length(2, "UF deve ter 2 letras."),
  municipality: z.string().trim().min(1),
  brand: z.string().trim().min(1).optional(),
  label: z.string().trim().min(1).optional(),
});

/** Alerta por série (combustível). */
export const createFuelAlertSchema = z.object({
  seriesId: z.string().uuid("seriesId deve ser um UUID."),
  thresholdPrice: z.number().positive("thresholdPrice deve ser um número positivo"),
  currency: z.string().optional(),
  channel: z.literal("email").optional(),
  enabled: z.boolean().optional(),
});

/** Param :id como UUID (favoritos/alertas de combustível). */
export const uuidParamSchema = z.object({
  id: z.string().uuid("id deve ser um UUID."),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type CreateAlertInput = z.infer<typeof createAlertSchema>;
