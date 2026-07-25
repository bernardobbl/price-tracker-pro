import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildAnpUrls, defaultAnpPeriods } from "../src/ingest/anpIngestor";

/**
 * A lista de arquivos da ANP deve acompanhar o calendário: o job semanal roda por
 * meses em produção, então os meses-alvo são derivados da data de execução (não de
 * env fixo). Env (ANP_CSV_URL / ANP_YEAR / ANP_MONTHS) vira override explícito.
 */

// Isola os testes de qualquer ANP_* herdado do shell/.env do dev.
beforeEach(() => {
  vi.stubEnv("ANP_CSV_URL", "");
  vi.stubEnv("ANP_YEAR", "");
  vi.stubEnv("ANP_MONTHS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("defaultAnpPeriods", () => {
  it("retorna mês corrente + 2 anteriores em ordem cronológica", () => {
    const periods = defaultAnpPeriods(new Date(Date.UTC(2026, 6, 25))); // 25/jul/2026
    expect(periods).toEqual([
      { year: "2026", month: "05" },
      { year: "2026", month: "06" },
      { year: "2026", month: "07" },
    ]);
  });

  it("trata a virada de ano (janeiro puxa nov/dez do ano anterior)", () => {
    const periods = defaultAnpPeriods(new Date(Date.UTC(2027, 0, 10))); // 10/jan/2027
    expect(periods).toEqual([
      { year: "2026", month: "11" },
      { year: "2026", month: "12" },
      { year: "2027", month: "01" },
    ]);
  });

  it("respeita a quantidade pedida", () => {
    expect(defaultAnpPeriods(new Date(Date.UTC(2026, 6, 1)), 1)).toEqual([
      { year: "2026", month: "07" },
    ]);
  });
});

describe("buildAnpUrls", () => {
  it("sem env, deriva da data atual: 3 meses × 2 grupos = 6 URLs", () => {
    const urls = buildAnpUrls(new Date(Date.UTC(2026, 6, 25)));
    expect(urls).toHaveLength(6);
    expect(urls[0]).toContain("/dsan/2026/precos-gasolina-etanol-05.csv");
    expect(urls[5]).toContain("/dsan/2026/precos-diesel-gnv-07.csv");
  });

  it("na virada de ano, cada mês carrega o ano correto no caminho", () => {
    const urls = buildAnpUrls(new Date(Date.UTC(2027, 0, 10)));
    expect(urls.some((u) => u.includes("/dsan/2026/precos-gasolina-etanol-12.csv"))).toBe(true);
    expect(urls.some((u) => u.includes("/dsan/2027/precos-gasolina-etanol-01.csv"))).toBe(true);
  });

  it("ANP_CSV_URL tem precedência total (arquivo único)", () => {
    vi.stubEnv("ANP_CSV_URL", "https://example.com/arquivo.csv");
    expect(buildAnpUrls(new Date(Date.UTC(2026, 6, 25)))).toEqual([
      "https://example.com/arquivo.csv",
    ]);
  });

  it("ANP_YEAR + ANP_MONTHS pinam o período (backfill histórico)", () => {
    vi.stubEnv("ANP_YEAR", "2025");
    vi.stubEnv("ANP_MONTHS", "10,11,12");
    const urls = buildAnpUrls(new Date(Date.UTC(2026, 6, 25)));
    expect(urls).toHaveLength(6);
    expect(urls.every((u) => u.includes("/dsan/2025/"))).toBe(true);
    expect(urls.some((u) => u.includes("-10.csv"))).toBe(true);
  });

  it("só ANP_MONTHS pinado usa o ano corrente", () => {
    vi.stubEnv("ANP_MONTHS", "01");
    const urls = buildAnpUrls(new Date(Date.UTC(2026, 6, 25)));
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => u.includes("/dsan/2026/") && u.includes("-01.csv"))).toBe(true);
  });
});
