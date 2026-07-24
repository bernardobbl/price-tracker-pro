/**
 * Schema Zod da linha de combustível normalizada (H4 — qualidade de dado).
 *
 * É o **gate final** do ETL, entre `dedupeFuelRows` e a persistência: um contrato
 * explícito do que pode ir para o banco. Em condições normais o `normalizeFuelRows`
 * já rejeita o essencial, então este gate deve deixar tudo passar — seu valor é
 * defense-in-depth: se uma regressão na normalização deixar passar uma linha
 * inconsistente (data impossível, UF vazia, preço absurdo), o Zod barra aqui
 * e a contagem entra em `rows_rejected`, visível no `ingestion_runs`.
 */

import { z } from "zod";
import type { NormalizedFuelRow } from "./anpNormalize";

export const normalizedFuelRowSchema = z.object({
  region: z.string(),
  state: z.string().min(1).max(4),
  municipality: z.string().min(1),
  reseller: z.string(),
  // CNPJ só-dígitos (o normalizador remove pontuação); 14 quando presente, "" tolerado.
  cnpj: z.string().regex(/^\d{0,14}$/),
  product: z.string().min(1),
  // Data ISO yyyy-mm-dd (o parser já garante o formato).
  collectedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sellPrice: z.number().positive().max(1000),
  buyPrice: z.number().positive().nullable(),
  unit: z.string(),
  brand: z.string(),
  // Endereço (free-text, opcional) — localização do posto.
  street: z.string().optional(),
  streetNumber: z.string().optional(),
  neighborhood: z.string().optional(),
  cep: z.string().optional(),
});

export interface PartitionResult {
  valid: NormalizedFuelRow[];
  /** Quantidade de linhas barradas pelo schema. */
  invalid: number;
  /** Amostra de motivos (por caminho) para o log — limitada para não poluir. */
  sampleIssues: string[];
}

/**
 * Separa linhas válidas das inválidas segundo o schema, contando as barradas
 * e coletando uma pequena amostra de motivos para observabilidade.
 */
export function filterValidRows(rows: NormalizedFuelRow[]): PartitionResult {
  const valid: NormalizedFuelRow[] = [];
  let invalid = 0;
  const sampleIssues: string[] = [];

  for (const row of rows) {
    const result = normalizedFuelRowSchema.safeParse(row);
    if (result.success) {
      valid.push(row);
    } else {
      invalid++;
      if (sampleIssues.length < 5) {
        const issue = result.error.issues[0];
        sampleIssues.push(`${issue.path.join(".")}: ${issue.message}`);
      }
    }
  }

  return { valid, invalid, sampleIssues };
}
