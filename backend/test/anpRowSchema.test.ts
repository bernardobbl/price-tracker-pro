import { describe, it, expect } from "vitest";
import { normalizedFuelRowSchema, filterValidRows } from "../src/ingest/anpRowSchema";
import type { NormalizedFuelRow } from "../src/ingest/anpNormalize";

const valid: NormalizedFuelRow = {
  region: "SE",
  state: "SP",
  municipality: "SAO PAULO",
  reseller: "POSTO X",
  cnpj: "12345678000190",
  product: "GASOLINA",
  collectedAt: "2026-07-01",
  sellPrice: 5.89,
  buyPrice: 5.2,
  unit: "R$ / litro",
  brand: "VIBRA",
};

describe("normalizedFuelRowSchema", () => {
  it("aceita uma linha bem formada", () => {
    expect(normalizedFuelRowSchema.safeParse(valid).success).toBe(true);
  });

  it("aceita buyPrice null e brand vazio", () => {
    expect(normalizedFuelRowSchema.safeParse({ ...valid, buyPrice: null, brand: "" }).success).toBe(true);
  });

  it("rejeita data fora do formato ISO", () => {
    expect(normalizedFuelRowSchema.safeParse({ ...valid, collectedAt: "01/07/2026" }).success).toBe(false);
  });

  it("rejeita UF/município vazios e preço fora da faixa", () => {
    expect(normalizedFuelRowSchema.safeParse({ ...valid, state: "" }).success).toBe(false);
    expect(normalizedFuelRowSchema.safeParse({ ...valid, municipality: "" }).success).toBe(false);
    expect(normalizedFuelRowSchema.safeParse({ ...valid, sellPrice: 0 }).success).toBe(false);
    expect(normalizedFuelRowSchema.safeParse({ ...valid, sellPrice: 5000 }).success).toBe(false);
  });

  it("rejeita CNPJ com pontuação (deve vir só-dígitos)", () => {
    expect(normalizedFuelRowSchema.safeParse({ ...valid, cnpj: "12.345.678/0001-90" }).success).toBe(false);
  });
});

describe("filterValidRows", () => {
  it("particiona válidas/ inválidas e conta as barradas", () => {
    const { valid: ok, invalid, sampleIssues } = filterValidRows([
      valid,
      { ...valid, collectedAt: "bad-date" },
      { ...valid, state: "" },
    ]);
    expect(ok).toHaveLength(1);
    expect(invalid).toBe(2);
    expect(sampleIssues.length).toBeGreaterThan(0);
  });
});
