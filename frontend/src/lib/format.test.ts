import { describe, it, expect } from "vitest";
import { fmt, formatLocation, mapsUrl, sameSeries } from "./format";
import type { SeriesView } from "../types";

describe("fmt", () => {
  it("formata com 3 casas por padrão (pt-BR)", () => {
    expect(fmt(5.9)).toBe("5,900");
    expect(fmt(6)).toBe("6,000");
  });

  it("respeita o número de casas informado", () => {
    expect(fmt(5.9, 2)).toBe("5,90");
  });
});

describe("formatLocation", () => {
  it("monta rua, número e bairro em title case", () => {
    expect(
      formatLocation({ street: "AV BRASIL", streetNumber: "1234", neighborhood: "PINHEIROS" })
    ).toBe("Av Brasil, 1234 · Pinheiros");
  });

  it("omite partes ausentes sem separadores soltos", () => {
    expect(formatLocation({ street: "RUA A" })).toBe("Rua A");
    expect(formatLocation({})).toBe("");
  });
});

describe("mapsUrl", () => {
  it("gera um link de busca do Google Maps com o posto e o município", () => {
    const url = mapsUrl(
      { reseller: "POSTO X", street: "RUA A", streetNumber: "10", neighborhood: "CENTRO" },
      { municipality: "SAO PAULO", state: "SP" }
    );
    expect(url).toContain("https://www.google.com/maps/search/?api=1&query=");
    expect(decodeURIComponent(url)).toContain("POSTO X");
    expect(decodeURIComponent(url)).toContain("SP");
    expect(decodeURIComponent(url)).toContain("Brasil");
  });
});

describe("sameSeries", () => {
  const base: SeriesView = {
    product: "GASOLINA",
    state: "SP",
    municipality: "SAO PAULO",
    brand: null,
    label: "Gasolina · São Paulo/SP",
  };

  it("é verdadeiro para a mesma combinação (brand null ≡ undefined)", () => {
    expect(sameSeries(base, { product: "GASOLINA", state: "SP", municipality: "SAO PAULO", brand: null })).toBe(true);
  });

  it("é falso quando qualquer dimensão difere", () => {
    expect(sameSeries(base, { product: "ETANOL", state: "SP", municipality: "SAO PAULO", brand: null })).toBe(false);
    expect(sameSeries(base, { product: "GASOLINA", state: "RJ", municipality: "SAO PAULO", brand: null })).toBe(false);
  });
});
