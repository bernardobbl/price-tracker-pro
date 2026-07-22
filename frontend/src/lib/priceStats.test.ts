import { describe, it, expect } from "vitest";
import { computePriceStats } from "./priceStats";
import type { PriceHistoryItem } from "../types";

function item(price: number): PriceHistoryItem {
  return {
    date: "2026-01-01T00:00:00.000Z",
    fullPrice: price,
    discountedPrice: price,
    currency: "R$",
    title: "produto",
    url: "",
  };
}

describe("computePriceStats", () => {
  it("retorna tudo nulo para histórico vazio", () => {
    expect(computePriceStats([])).toEqual({
      current: null,
      min: null,
      max: null,
      avg: null,
      changePct: null,
      isLowestEver: false,
    });
  });

  it("calcula current, min, max e avg", () => {
    const s = computePriceStats([item(100), item(200), item(150)]);
    expect(s.current).toBe(150);
    expect(s.min).toBe(100);
    expect(s.max).toBe(200);
    expect(s.avg).toBe(150);
  });

  it("calcula a variação % vs. o registro anterior", () => {
    expect(computePriceStats([item(100), item(120)]).changePct).toBeCloseTo(20);
    expect(computePriceStats([item(100), item(80)]).changePct).toBeCloseTo(-20);
  });

  it("changePct é null com um único registro", () => {
    expect(computePriceStats([item(100)]).changePct).toBeNull();
  });

  it("marca isLowestEver quando o preço atual é o menor", () => {
    expect(computePriceStats([item(200), item(100)]).isLowestEver).toBe(true);
    expect(computePriceStats([item(100), item(200)]).isLowestEver).toBe(false);
  });
});
