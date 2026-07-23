import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import { parseAnpCsv, type FuelPriceRow } from "../src/ingest/anpParser";
import {
  canonicalProduct,
  normalizeCnpj,
  normalizeFuelRows,
  dedupeFuelRows,
  naturalKey,
  type NormalizedFuelRow,
} from "../src/ingest/anpNormalize";

const sampleCsv = fs.readFileSync(path.join(__dirname, "fixtures/anpSample.csv"), "utf-8");

/** Helper: monta uma FuelPriceRow com defaults plausíveis. */
function row(overrides: Partial<FuelPriceRow> = {}): FuelPriceRow {
  return {
    region: "SE",
    state: "SP",
    municipality: "SAO PAULO",
    reseller: "POSTO X",
    cnpj: "12.345.678/0001-90",
    product: "GASOLINA",
    collectedAt: "2026-07-01",
    sellPrice: 5.89,
    buyPrice: 5.2,
    unit: "R$ / litro",
    brand: "VIBRA",
    ...overrides,
  };
}

describe("canonicalProduct", () => {
  it("padroniza variações históricas de rótulo", () => {
    expect(canonicalProduct("GASOLINA COMUM")).toBe("GASOLINA");
    expect(canonicalProduct("Gasolina C")).toBe("GASOLINA");
    expect(canonicalProduct("Etanol Hidratado")).toBe("ETANOL");
    expect(canonicalProduct("GAS NATURAL VEICULAR")).toBe("GNV");
    expect(canonicalProduct("Óleo Diesel S10")).toBe("DIESEL S10");
    expect(canonicalProduct("GLP P13")).toBe("GLP");
  });

  it("mantém produtos já canônicos e colapsa espaços/caixa", () => {
    expect(canonicalProduct("  gasolina   aditivada ")).toBe("GASOLINA ADITIVADA");
    expect(canonicalProduct("DIESEL S500")).toBe("DIESEL S500");
  });

  it("retorna vazio para entrada ausente", () => {
    expect(canonicalProduct(undefined)).toBe("");
    expect(canonicalProduct("   ")).toBe("");
  });
});

describe("normalizeCnpj", () => {
  it("mantém só os dígitos", () => {
    expect(normalizeCnpj("12.345.678/0001-90")).toBe("12345678000190");
    expect(normalizeCnpj(undefined)).toBe("");
  });
});

describe("normalizeFuelRows", () => {
  it("normaliza campos e converte buyPrice ausente/zero em null", () => {
    const { rows, stats } = normalizeFuelRows([
      row({ municipality: "  são   paulo ", brand: "vibra", buyPrice: 0 }),
    ]);
    expect(stats.kept).toBe(1);
    const r = rows[0];
    expect(r.municipality).toBe("SÃO PAULO");
    expect(r.brand).toBe("VIBRA");
    expect(r.cnpj).toBe("12345678000190");
    expect(r.buyPrice).toBeNull();
  });

  it("rejeita preço fora da faixa plausível, com motivo", () => {
    const { rows, stats } = normalizeFuelRows([
      row({ sellPrice: 0 }),
      row({ sellPrice: 5890 }),
      row({ sellPrice: 5.89 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(stats.rejected).toBe(2);
    expect(stats.rejectedReasons["preco_fora_da_faixa"]).toBe(2);
  });

  it("rejeita produto ou local inválidos", () => {
    const { stats } = normalizeFuelRows([
      row({ product: "   " }),
      row({ state: "" }),
    ]);
    expect(stats.rejectedReasons["produto_invalido"]).toBe(1);
    expect(stats.rejectedReasons["local_incompleto"]).toBe(1);
  });

  it("processa a fixture real (5 linhas válidas) sem rejeições", () => {
    const parsed = parseAnpCsv(sampleCsv);
    const { rows, stats } = normalizeFuelRows(parsed);
    expect(stats.read).toBe(5);
    expect(rows).toHaveLength(5);
    expect(stats.rejected).toBe(0);
  });
});

describe("dedupeFuelRows", () => {
  const base: NormalizedFuelRow = {
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

  it("colapsa a mesma chave natural mantendo a última", () => {
    const { rows, removed } = dedupeFuelRows([
      base,
      { ...base, sellPrice: 5.99 }, // mesma chave, preço atualizado → vence
    ]);
    expect(rows).toHaveLength(1);
    expect(removed).toBe(1);
    expect(rows[0].sellPrice).toBe(5.99);
  });

  it("preserva chaves distintas (data ou produto diferentes)", () => {
    const { rows, removed } = dedupeFuelRows([
      base,
      { ...base, collectedAt: "2026-07-08" },
      { ...base, product: "ETANOL" },
    ]);
    expect(rows).toHaveLength(3);
    expect(removed).toBe(0);
  });

  it("naturalKey usa cnpj+produto+data", () => {
    expect(naturalKey(base)).toBe("12345678000190|GASOLINA|2026-07-01");
  });
});
