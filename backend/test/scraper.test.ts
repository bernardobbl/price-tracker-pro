import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import {
  parseCatalogueListing,
  parseBookDetail,
  parseMoney,
} from "../src/scrapers/booksToScrapeScraper";
import { ScrapeError } from "../src/scrapers/httpClient";

const listingHtml = fs.readFileSync(path.join(__dirname, "fixtures/booksListing.html"), "utf-8");
const detailHtml = fs.readFileSync(path.join(__dirname, "fixtures/booksDetail.html"), "utf-8");

describe("parseMoney", () => {
  it("extrai moeda e valor", () => {
    expect(parseMoney("£51.77")).toEqual({ currency: "£", price: 51.77 });
  });

  it("ignora lixo de encoding antes do símbolo", () => {
    expect(parseMoney("Â£53.74")).toEqual({ currency: "£", price: 53.74 });
  });
});

describe("parseCatalogueListing", () => {
  it("extrai título, url e preço dos livros", () => {
    const items = parseCatalogueListing(listingHtml);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("A Light in the Attic");
    expect(items[0].price).toBe(51.77);
    expect(items[0].currency).toBe("£");
    expect(items[0].url).toBe(
      "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html"
    );
    expect(items[1].title).toBe("Tipping the Velvet");
  });
});

describe("parseBookDetail", () => {
  it("extrai título e preço da página de detalhe", () => {
    const detail = parseBookDetail(detailHtml);
    expect(detail.title).toBe("A Light in the Attic");
    expect(detail.price).toBe(51.77);
    expect(detail.currency).toBe("£");
  });

  it("lança ScrapeError PRICE_NOT_FOUND quando não há preço", () => {
    try {
      parseBookDetail("<div><h1>Sem preço</h1></div>");
      expect.unreachable("deveria ter lançado");
    } catch (err) {
      expect(err).toBeInstanceOf(ScrapeError);
      expect((err as ScrapeError).code).toBe("PRICE_NOT_FOUND");
    }
  });
});
