import { describe, it, expect } from "vitest";
import { fmt, formatAxisPrice, formatLocation, mapsUrl, sameSeries } from "./format";
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

describe("formatAxisPrice", () => {
  it("corta o ruído de ponto flutuante dos ticks do Chart.js", () => {
    // Valores reais observados no eixo Y (Diesel S10 / RJ).
    expect(formatAxisPrice(7.600000000000001, "R$")).toBe("R$ 7,600");
    expect(formatAxisPrice(7.200000000000001, "R$")).toBe("R$ 7,200");
    expect(formatAxisPrice(6.800000000000001, "R$")).toBe("R$ 6,800");
  });

  it("mantém o padrão pt-BR e o número de casas pedido", () => {
    expect(formatAxisPrice(6.99, "R$")).toBe("R$ 6,990");
    expect(formatAxisPrice(6.99, "R$", 2)).toBe("R$ 6,99");
  });

  it("aceita tick em string (o Chart.js tipa como string | number)", () => {
    expect(formatAxisPrice("7.6", "R$")).toBe("R$ 7,600");
  });

  it("não quebra com valor não numérico", () => {
    expect(formatAxisPrice("--", "R$")).toBe("R$ --");
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
