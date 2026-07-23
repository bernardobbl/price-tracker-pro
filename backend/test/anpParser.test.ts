import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import { parseAnpCsv, parseMoneyBR, parseDateBR } from "../src/ingest/anpParser";

const sampleCsv = fs.readFileSync(path.join(__dirname, "fixtures/anpSample.csv"), "utf-8");

describe("parseMoneyBR", () => {
  it("converte decimal com vírgula", () => {
    expect(parseMoneyBR("5,89")).toBe(5.89);
  });

  it("trata separador de milhar", () => {
    expect(parseMoneyBR("1.234,56")).toBe(1234.56);
    expect(parseMoneyBR("R$ 6,10")).toBe(6.1);
  });

  it("retorna null para vazio/indefinido", () => {
    expect(parseMoneyBR("")).toBeNull();
    expect(parseMoneyBR("   ")).toBeNull();
    expect(parseMoneyBR(undefined)).toBeNull();
  });
});

describe("parseDateBR", () => {
  it("converte dd/mm/aaaa em ISO", () => {
    expect(parseDateBR("01/07/2026")).toBe("2026-07-01");
  });

  it("rejeita formatos inválidos", () => {
    expect(parseDateBR("2026-07-01")).toBeNull();
    expect(parseDateBR("32/13/2026")).toBeNull();
    expect(parseDateBR("")).toBeNull();
  });
});

describe("parseAnpCsv", () => {
  const rows = parseAnpCsv(sampleCsv);

  it("descarta linhas sem preço/data válidos (2 das 7 linhas)", () => {
    expect(rows).toHaveLength(5);
  });

  it("mapeia colunas pelo cabeçalho (tolerante a acentos)", () => {
    const first = rows[0];
    expect(first.region).toBe("SE");
    expect(first.state).toBe("SP");
    expect(first.municipality).toBe("SAO PAULO");
    expect(first.product).toBe("GASOLINA");
    expect(first.collectedAt).toBe("2026-07-01");
    expect(first.sellPrice).toBe(5.89);
    expect(first.buyPrice).toBe(5.2);
    expect(first.brand).toBe("VIBRA");
  });

  it("trata valor de compra ausente como null", () => {
    const etanol = rows.find((r) => r.product === "ETANOL");
    expect(etanol?.buyPrice).toBeNull();
    expect(etanol?.sellPrice).toBe(3.99);
  });

  it("preserva múltiplas datas do mesmo posto (série temporal)", () => {
    const curitiba = rows.filter((r) => r.municipality === "CURITIBA");
    expect(curitiba.map((r) => r.collectedAt).sort()).toEqual(["2026-07-01", "2026-07-08"]);
  });

  it("é robusto a CSV vazio", () => {
    expect(parseAnpCsv("")).toEqual([]);
    expect(parseAnpCsv("só cabeçalho;sem dados")).toEqual([]);
  });
});
