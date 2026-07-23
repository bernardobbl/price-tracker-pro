import { describe, it, expect } from "vitest";
import { buildSeriesLabel } from "../src/lib/seriesLabel";

describe("buildSeriesLabel", () => {
  it("formata produto + município/UF", () => {
    expect(buildSeriesLabel("GASOLINA", "SP", "SAO PAULO")).toBe("Gasolina · Sao Paulo/SP");
  });

  it("preserva siglas de produto (S10) e adiciona bandeira", () => {
    expect(buildSeriesLabel("DIESEL S10", "BA", "SALVADOR", "SHELL")).toBe(
      "Diesel S10 · Salvador/BA (Shell)"
    );
  });

  it("mantém GNV/GLP em maiúsculas", () => {
    expect(buildSeriesLabel("GNV", "RJ", "RIO DE JANEIRO")).toBe("GNV · Rio De Janeiro/RJ");
  });

  it("ignora bandeira vazia", () => {
    expect(buildSeriesLabel("ETANOL", "PR", "CURITIBA", "")).toBe("Etanol · Curitiba/PR");
  });
});
