import { z } from "zod";
import { isKnownLegalVersion, LEGAL_VERSIONS } from "../lib/legalVersions";

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

// ── Cobrança / assinatura ───────────────────────────────────────────────────

/**
 * Início do checkout.
 *
 * ⚠️ **Não existe campo de valor aqui, e isso é deliberado.** O front manda só
 * a chave do plano; quem decide o preço é o backend (`PLAN_PRICE_CENTS`). Se o
 * valor viesse do cliente, qualquer um pagaria R$ 0,01 pelo anual.
 */
export const createCheckoutSchema = z.object({
  plan: z.enum(["mensal", "anual"], {
    message: "plan deve ser 'mensal' ou 'anual'.",
  }),
  /**
   * Versão dos documentos legais aceita na tela — grava junto como prova.
   *
   * ⚠️ **Lista branca, não string livre.** O valor é a metade verificável da
   * prova de aceite (a outra é o horário, que vem do servidor). Aceitar
   * qualquer string deixaria um cliente forjado gravar uma versão que nunca
   * existiu — e um registro de aceite que não se pode conferir não é prova.
   * Ao publicar uma versão nova, acrescente em `lib/legalVersions.ts`.
   */
  legalVersion: z
    .string()
    .trim()
    .refine(isKnownLegalVersion, {
      message: `legalVersion deve ser uma versão conhecida: ${LEGAL_VERSIONS.join(", ")}.`,
    }),
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

/**
 * Confirmação de estorno.
 *
 * `expectedCents` **não** é o valor a devolver — é a confirmação de que quem
 * pede está vendo a mesma conta que o backend calculou. O valor real sai da
 * política, no `previewRefund`; divergência recusa a operação. Dinheiro saindo
 * merece uma confirmação que não seja um clique só.
 */
export const refundChargeSchema = z.object({
  chargeId: z.string().uuid("chargeId deve ser um UUID."),
  expectedCents: z
    .number()
    .int("expectedCents deve ser um inteiro em centavos.")
    .nonnegative("expectedCents não pode ser negativo."),
});

/**
 * Exclusão de conta.
 *
 * Exige digitar a palavra exata. É irreversível e apaga favoritos e alertas em
 * cascata — um `DELETE` que dispara sem atrito é um acidente esperando data.
 */
export const deleteAccountSchema = z.object({
  confirm: z.literal("EXCLUIR MINHA CONTA", {
    message: 'Para confirmar, envie confirm: "EXCLUIR MINHA CONTA".',
  }),
});

export type CreateTrackedSeriesInput = z.infer<typeof createTrackedSeriesSchema>;
export type CreateFuelAlertInput = z.infer<typeof createFuelAlertSchema>;
