import * as cheerio from "cheerio";
import { fetchHtml, ScrapeError } from "./httpClient";

export interface ScrapedPriceResult {
  price: number;
  originalPrice?: number;
  currency: string;
  title: string;
  url: string;
}

export interface SearchResultItem {
  title: string;
  url: string;
  price: number;
  currency: string;
}

const CATALOGUE_BASE = "https://books.toscrape.com/catalogue";
// Quantas páginas do catálogo varrer numa busca (20 livros por página).
const MAX_PAGES = 5;

function pageUrl(n: number): string {
  return `${CATALOGUE_BASE}/page-${n}.html`;
}

/** Extrai moeda e valor de textos como "£51.77" (robusto a lixo de encoding). */
export function parseMoney(text: string): { currency: string; price: number } {
  const t = text.replace(/\s+/g, " ").trim();
  const numMatch = t.match(/[\d.,]+/);
  const price = numMatch ? parseFloat(numMatch[0].replace(/,/g, "")) : NaN;
  const symMatch = t.match(/\p{Sc}/u); // qualquer símbolo de moeda unicode
  const currency = symMatch ? symMatch[0] : "£";
  return { currency, price };
}

export interface ListingItem {
  title: string;
  url: string;
  price: number;
  currency: string;
}

// ── Parsers puros (recebem HTML → fáceis de testar) ─────────────────────────

/** Extrai os livros de uma página de listagem do catálogo. */
export function parseCatalogueListing(html: string): ListingItem[] {
  const $ = cheerio.load(html);
  const items: ListingItem[] = [];

  $("article.product_pod").each((_i, el) => {
    const anchor = $(el).find("h3 a");
    const title = (anchor.attr("title") || anchor.text()).trim();
    const href = anchor.attr("href") || "";
    // href é relativo à pasta catalogue/ (ex.: "a-light..._1000/index.html")
    const url = href ? `${CATALOGUE_BASE}/${href.replace(/^(\.\.\/)+/, "")}` : "";
    const { currency, price } = parseMoney($(el).find(".price_color").first().text());

    if (title && url) {
      items.push({ title, url, price, currency });
    }
  });

  return items;
}

/** Extrai preço/título da página de detalhe de um livro. */
export function parseBookDetail(html: string): { title: string; price: number; currency: string } {
  const $ = cheerio.load(html);
  const title = $("h1").first().text().trim();
  const priceText = $(".price_color").first().text();

  if (!priceText) {
    throw new ScrapeError("PRICE_NOT_FOUND", "Preço não encontrado na página do livro.");
  }

  const { currency, price } = parseMoney(priceText);
  return { title, price, currency };
}

// ── Orquestradores (fetch + parse) ──────────────────────────────────────────

/** Varre o catálogo e retorna até `limit` livros cujo título contém a busca. */
export async function searchBooks(
  query: string,
  limit = 10,
  maxPages = MAX_PAGES
): Promise<SearchResultItem[]> {
  const q = query.trim().toLowerCase();
  const results: SearchResultItem[] = [];

  for (let page = 1; page <= maxPages && results.length < limit; page++) {
    let html: string;
    try {
      html = await fetchHtml(pageUrl(page));
    } catch {
      break; // fim do catálogo ou erro de rede
    }

    const items = parseCatalogueListing(html);
    if (items.length === 0) break;

    for (const item of items) {
      if (!q || item.title.toLowerCase().includes(q)) {
        results.push({
          title: item.title,
          url: item.url,
          price: item.price,
          currency: item.currency
        });
        if (results.length >= limit) break;
      }
    }
  }

  return results;
}

/** Rastreia o preço do primeiro livro que casa com a busca (lista → detalhe). */
export async function scrapeBookPrice(query: string): Promise<ScrapedPriceResult> {
  const q = query.trim().toLowerCase();

  for (let page = 1; page <= MAX_PAGES; page++) {
    let html: string;
    try {
      html = await fetchHtml(pageUrl(page));
    } catch {
      break;
    }

    const items = parseCatalogueListing(html);
    if (items.length === 0) break;

    const match = items.find((it) => !q || it.title.toLowerCase().includes(q));
    if (!match) continue;

    // Best-effort: preço preciso na página de detalhe; senão, usa o da listagem.
    try {
      const detail = parseBookDetail(await fetchHtml(match.url, { retries: 1 }));
      return {
        price: detail.price,
        currency: detail.currency,
        title: detail.title || match.title,
        url: match.url,
      };
    } catch {
      return { price: match.price, currency: match.currency, title: match.title, url: match.url };
    }
  }

  throw new ScrapeError("PRICE_NOT_FOUND", `Nenhum livro encontrado para "${query}".`);
}
