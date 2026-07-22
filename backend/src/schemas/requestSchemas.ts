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

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type CreateAlertInput = z.infer<typeof createAlertSchema>;
