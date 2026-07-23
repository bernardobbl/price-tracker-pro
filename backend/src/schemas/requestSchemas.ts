import { z } from "zod";

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

export type CreateTrackedSeriesInput = z.infer<typeof createTrackedSeriesSchema>;
export type CreateFuelAlertInput = z.infer<typeof createFuelAlertSchema>;
