import { describe, it, expect } from "vitest";
import {
  aggregateDailySeries,
  summarizeSnapshot,
  type FuelPriceRecord,
} from "../src/lib/fuelAggregate";

function rec(overrides: Partial<FuelPriceRecord> = {}): FuelPriceRecord {
  return {
    collectedAt: "2026-07-01",
    sellPrice: 5.5,
    reseller: "POSTO A",
    brand: "VIBRA",
    cnpj: "11111111000191",
    ...overrides,
  };
}

describe("aggregateDailySeries", () => {
  it("agrupa por data com média/mín/máx e amostra", () => {
    const series = aggregateDailySeries([
      rec({ collectedAt: "2026-07-01", sellPrice: 5.0, cnpj: "a" }),
      rec({ collectedAt: "2026-07-01", sellPrice: 6.0, cnpj: "b" }),
      rec({ collectedAt: "2026-07-08", sellPrice: 5.5, cnpj: "a" }),
    ]);
    expect(series).toHaveLength(2);
    expect(series[0]).toEqual({
      date: "2026-07-01",
      avgPrice: 5.5,
      minPrice: 5.0,
      maxPrice: 6.0,
      sampleSize: 2,
    });
    expect(series[1].date).toBe("2026-07-08");
  });

  it("retorna ordenado por data crescente", () => {
    const series = aggregateDailySeries([
      rec({ collectedAt: "2026-07-15", cnpj: "a" }),
      rec({ collectedAt: "2026-07-01", cnpj: "b" }),
    ]);
    expect(series.map((s) => s.date)).toEqual(["2026-07-01", "2026-07-15"]);
  });

  it("é robusto a lista vazia", () => {
    expect(aggregateDailySeries([])).toEqual([]);
  });
});

describe("summarizeSnapshot", () => {
  it("resume o levantamento mais recente com ranking asc", () => {
    const snap = summarizeSnapshot([
      rec({ collectedAt: "2026-07-01", sellPrice: 5.0, cnpj: "old" }),
      rec({ collectedAt: "2026-07-08", sellPrice: 6.2, reseller: "CARO", cnpj: "c" }),
      rec({ collectedAt: "2026-07-08", sellPrice: 5.8, reseller: "BARATO", cnpj: "b" }),
    ]);
    expect(snap.date).toBe("2026-07-08");
    expect(snap.minPrice).toBe(5.8);
    expect(snap.maxPrice).toBe(6.2);
    expect(snap.avgPrice).toBe(6.0);
    expect(snap.sampleSize).toBe(2);
    expect(snap.quotes.map((q) => q.reseller)).toEqual(["BARATO", "CARO"]);
  });

  it("carrega o endereço do posto na cotação do ranking", () => {
    const snap = summarizeSnapshot([
      rec({
        collectedAt: "2026-07-08",
        sellPrice: 5.7,
        reseller: "AUTO POSTO PINHEIROS A",
        cnpj: "p",
        street: "AV BRASIL",
        streetNumber: "1234",
        neighborhood: "PINHEIROS",
        cep: "05411-000",
      }),
    ]);
    const q = snap.quotes[0];
    expect(q.street).toBe("AV BRASIL");
    expect(q.streetNumber).toBe("1234");
    expect(q.neighborhood).toBe("PINHEIROS");
    expect(q.cep).toBe("05411-000");
  });

  it("colapsa duplicatas por CNPJ mantendo o menor preço", () => {
    const snap = summarizeSnapshot([
      rec({ collectedAt: "2026-07-08", sellPrice: 6.0, cnpj: "same" }),
      rec({ collectedAt: "2026-07-08", sellPrice: 5.5, cnpj: "same" }),
    ]);
    expect(snap.sampleSize).toBe(1);
    expect(snap.quotes[0].sellPrice).toBe(5.5);
  });

  it("retorna vazio para nenhum registro", () => {
    const snap = summarizeSnapshot([]);
    expect(snap.date).toBeNull();
    expect(snap.quotes).toEqual([]);
    expect(snap.avgPrice).toBeNull();
  });
});
