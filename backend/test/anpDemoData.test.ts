import { describe, it, expect } from "vitest";
import { buildAnpCsv, CITIES, WEEKS, ANP_HEADER } from "../scripts/lib/anpDemoData";
import { parseAnpCsv } from "../src/ingest/anpParser";
import { normalizeFuelRows, dedupeFuelRows } from "../src/ingest/anpNormalize";
import { filterValidRows } from "../src/ingest/anpRowSchema";

describe("anpDemoData.buildAnpCsv (amostra de seed no layout SHPC da ANP)", () => {
  const csv = buildAnpCsv();

  it("começa com o cabeçalho oficial da ANP", () => {
    expect(csv.split("\n")[0]).toBe(ANP_HEADER);
  });

  it("é determinístico (mesma saída entre execuções)", () => {
    expect(buildAnpCsv()).toBe(csv);
  });

  it("passa 100% limpo pelo pipeline ETL real (0 rejeitadas/dedup/barradas)", () => {
    const parsed = parseAnpCsv(csv);
    const { rows: normalized, stats } = normalizeFuelRows(parsed);
    const { rows: deduped, removed } = dedupeFuelRows(normalized);
    const { valid, invalid } = filterValidRows(deduped);

    expect(parsed.length).toBeGreaterThan(0);
    expect(stats.rejected).toBe(0);
    expect(removed).toBe(0);
    expect(invalid).toBe(0);
    expect(valid.length).toBe(parsed.length);
  });

  it("gera série temporal: uma linha de Gasolina/SP por semana com data ISO", () => {
    const parsed = parseAnpCsv(csv);
    const spGasolina = parsed.filter(
      (r) => r.product === "GASOLINA" && r.state === "SP" && r.municipality === "SAO PAULO"
    );
    const dates = new Set(spGasolina.map((r) => r.collectedAt));
    expect(dates.size).toBe(WEEKS);
    for (const d of dates) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("cobre todas as cidades da spec", () => {
    const parsed = parseAnpCsv(csv);
    const municipalities = new Set(parsed.map((r) => r.municipality));
    for (const c of CITIES) expect(municipalities.has(c.municipality)).toBe(true);
  });
});
