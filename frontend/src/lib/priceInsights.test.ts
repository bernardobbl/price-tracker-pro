import { describe, it, expect } from "vitest";
import { filterByPeriod, computeTrend, computeVolatility } from "./priceInsights";
import type { PriceHistoryItem } from "../types";
import type { PriceStats } from "./priceStats";

function item(price: number, daysAgo: number): PriceHistoryItem {
  const anchor = new Date("2026-06-30T00:00:00.000Z").getTime();
  return {
    date: new Date(anchor - daysAgo * 86_400_000).toISOString(),
    fullPrice: price,
    discountedPrice: price,
    currency: "£",
    title: "produto",
    url: ""
  };
}

function stats(partial: Partial<PriceStats>): PriceStats {
  return { current: null, min: null, max: null, avg: null, changePct: null, isLowestEver: false, ...partial };
}

describe("filterByPeriod", () => {
  const history = [item(10, 200), item(20, 100), item(30, 40), item(40, 10), item(50, 0)];

  it("devolve tudo quando period = all", () => {
    expect(filterByPeriod(history, "all")).toHaveLength(5);
  });

  it("recorta os últimos 30 dias (ancorado no mais recente)", () => {
    // anchor = 0 dias; cutoff = 30 dias atrás → sobram os itens de 10 e 0 dias.
    const out = filterByPeriod(history, "30d");
    expect(out.map((h) => h.discountedPrice)).toEqual([40, 50]);
  });

  it("faz fallback pro histórico inteiro se o recorte ficar vazio", () => {
    const single = [item(10, 500)];
    expect(filterByPeriod(single, "30d")).toHaveLength(1);
  });
});

describe("computeTrend", () => {
  it("fica indisponível com poucos pontos", () => {
    expect(computeTrend([item(10, 3), item(11, 2), item(12, 1)]).available).toBe(false);
  });

  it("detecta queda", () => {
    const h = [item(60, 6), item(58, 5), item(50, 4), item(45, 3), item(42, 2), item(40, 1)];
    const t = computeTrend(h, 2);
    expect(t.dir).toBe("down");
    expect(t.label).toBe("Caindo");
  });

  it("detecta alta", () => {
    const h = [item(40, 6), item(42, 5), item(45, 4), item(50, 3), item(58, 2), item(60, 1)];
    expect(computeTrend(h, 2).dir).toBe("up");
  });

  it("detecta estabilidade", () => {
    const h = [item(50, 6), item(50, 5), item(50, 4), item(50, 3), item(50, 2), item(50, 1)];
    expect(computeTrend(h, 2).dir).toBe("flat");
  });
});

describe("computeVolatility", () => {
  it("fica indisponível sem stats", () => {
    expect(computeVolatility(stats({})).available).toBe(false);
  });

  it("classifica baixa", () => {
    expect(computeVolatility(stats({ min: 49, max: 51, avg: 50 })).level).toBe("Baixa");
  });

  it("classifica alta", () => {
    expect(computeVolatility(stats({ min: 40, max: 60, avg: 50 })).level).toBe("Alta");
  });
});
