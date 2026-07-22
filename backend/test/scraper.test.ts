import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import {
  parseListingPrice,
  parseDetailPrice,
  parseSearchResults,
  buildSearchUrl,
} from "../src/scrapers/mercadoLivreScraper";
import { ScrapeError } from "../src/scrapers/httpClient";

const listingHtml = fs.readFileSync(path.join(__dirname, "fixtures/mlListing.html"), "utf-8");
const detailHtml = fs.readFileSync(path.join(__dirname, "fixtures/mlDetail.html"), "utf-8");

describe("parseListingPrice", () => {
  it("extrai preço, moeda, título e url do primeiro item", () => {
    const result = parseListingPrice(listingHtml);
    expect(result.price).toBe(4299.9);
    expect(result.currency).toBe("R$");
    expect(result.title).toBe("PlayStation 5 Slim 1TB");
    expect(result.url).toBe("https://item.mercadolivre.com.br/ps5-slim");
  });

  it("lança ScrapeError PRICE_NOT_FOUND quando não há preço", () => {
    const html = "<li class='ui-search-layout__item'><h2>Sem preço</h2></li>";
    try {
      parseListingPrice(html);
      expect.unreachable("deveria ter lançado");
    } catch (err) {
      expect(err).toBeInstanceOf(ScrapeError);
      expect((err as ScrapeError).code).toBe("PRICE_NOT_FOUND");
    }
  });
});

describe("parseDetailPrice", () => {
  it("extrai preço atual e preço anterior (desconto)", () => {
    const detail = parseDetailPrice(detailHtml);
    expect(detail.price).toBe(3999);
    expect(detail.originalPrice).toBe(4799.9);
  });

  it("retorna objeto vazio quando não há preço", () => {
    expect(parseDetailPrice("<div></div>")).toEqual({});
  });
});

describe("parseSearchResults", () => {
  it("retorna todos os resultados com título e url", () => {
    const results = parseSearchResults(listingHtml, 10);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("PlayStation 5 Slim 1TB");
    expect(results[1].url).toBe("https://item.mercadolivre.com.br/ps5-digital");
  });

  it("respeita o limite", () => {
    expect(parseSearchResults(listingHtml, 1)).toHaveLength(1);
  });
});

describe("buildSearchUrl", () => {
  it("faz o encode da query", () => {
    expect(buildSearchUrl("iphone 15")).toBe("https://lista.mercadolivre.com.br/iphone%2015");
  });
});
