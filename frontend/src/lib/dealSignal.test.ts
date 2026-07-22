import { describe, it, expect } from "vitest";
import { computeDealSignal } from "./dealSignal";
import type { PriceStats } from "./priceStats";

function stats(partial: Partial<PriceStats>): PriceStats {
  return {
    current: null,
    min: null,
    max: null,
    avg: null,
    changePct: null,
    isLowestEver: false,
    ...partial,
  };
}

describe("computeDealSignal", () => {
  it("fica indisponível sem dados", () => {
    const d = computeDealSignal(stats({}));
    expect(d.available).toBe(false);
    expect(d.tone).toBe("muted");
  });

  it("trata preço estável (sem variação)", () => {
    const d = computeDealSignal(stats({ current: 50, min: 50, max: 50, avg: 50 }));
    expect(d.available).toBe(true);
    expect(d.tone).toBe("muted");
    expect(d.label).toBe("Preço estável");
  });

  it("marca 'Compre já' e score 100 no menor preço", () => {
    const d = computeDealSignal(stats({ current: 40, min: 40, max: 60, avg: 50 }));
    expect(d.label).toBe("Compre já");
    expect(d.tone).toBe("success");
    expect(d.score).toBe(100);
    expect(d.positionPct).toBe(0);
  });

  it("marca 'Bom preço' abaixo da média", () => {
    const d = computeDealSignal(stats({ current: 45, min: 40, max: 60, avg: 50 }));
    expect(d.label).toBe("Bom preço");
    expect(d.tone).toBe("success");
  });

  it("marca 'Preço mediano' em torno da média", () => {
    const d = computeDealSignal(stats({ current: 51, min: 40, max: 60, avg: 50 }));
    expect(d.label).toBe("Preço mediano");
    expect(d.tone).toBe("warning");
  });

  it("marca 'Espere cair' e score 0 no maior preço", () => {
    const d = computeDealSignal(stats({ current: 60, min: 40, max: 60, avg: 50 }));
    expect(d.label).toBe("Espere cair");
    expect(d.tone).toBe("danger");
    expect(d.score).toBe(0);
    expect(d.positionPct).toBe(100);
  });

  it("calcula a posição no meio da faixa", () => {
    const d = computeDealSignal(stats({ current: 50, min: 40, max: 60, avg: 55 }));
    expect(d.positionPct).toBe(50);
    expect(d.score).toBe(50);
  });
});
