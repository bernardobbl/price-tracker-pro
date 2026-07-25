import { describe, it, expect } from "vitest";
import { summarizeSnapshot, type FuelPriceRecord } from "../src/lib/fuelAggregate";

// A agregação da série diária (média/mín/máx por data) migrou para o Postgres
// (RPC fuel_daily_series — ver schema.sql), então não há mais versão JS a testar.
// O que permanece puro (e testado aqui) é o resumo do último levantamento.

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
