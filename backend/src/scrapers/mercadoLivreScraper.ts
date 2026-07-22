import * as cheerio from "cheerio";
import { fetchHtml, ScrapeError } from "./httpClient";

export interface ScrapedPriceResult {
  // Preço principal exibido (geralmente com desconto)
  price: number;
  // Preço cheio/anterior, se disponível
  originalPrice?: number;
  currency: string;
  title: string;
  url: string;
}

export interface SearchResultItem {
  title: string;
  url: string;
}

const SEARCH_BASE = "https://lista.mercadolivre.com.br";

export function buildSearchUrl(searchQuery: string): string {
  return `${SEARCH_BASE}/${encodeURIComponent(searchQuery)}`;
}

/**
 * Converte "fraction"/"cents" do Mercado Livre em número.
 * Ex.: fraction="4.299" cents="90" → 4299.9
 */
function parseMoney(fractionText: string, centsText: string): number {
  const fraction = fractionText.replace(/\./g, "");
  const cents = centsText || "00";
  return parseFloat(`${fraction},${cents}`.replace(".", "").replace(",", "."));
}

// ── Parsers puros (recebem HTML como string → fáceis de testar) ──────────────

/** Extrai preço/título/link do primeiro item da página de busca. */
export function parseListingPrice(html: string): ScrapedPriceResult {
  const $ = cheerio.load(html);
  const firstItem = $("li.ui-search-layout__item").first();

  const title =
    firstItem.find("h2.ui-search-item__title").first().text().trim() ||
    firstItem.find("h2").first().text().trim();

  const link =
    firstItem.find("a.ui-search-link").attr("href") ||
    firstItem.find("a").first().attr("href") ||
    "";

  const fractionText = firstItem.find(".andes-money-amount__fraction").first().text().replace(/\./g, "");
  const centsText = firstItem.find(".andes-money-amount__cents").first().text() || "00";
  const currency = firstItem.find(".andes-money-amount__currency-symbol").first().text().trim() || "R$";

  if (!fractionText) {
    throw new ScrapeError(
      "PRICE_NOT_FOUND",
      "Não foi possível encontrar o preço no HTML do Mercado Livre."
    );
  }

  return {
    price: parseMoney(fractionText, centsText),
    currency,
    title,
    url: link,
  };
}

/** Extrai preço atual e preço anterior (quando há desconto) da página do anúncio. */
export function parseDetailPrice(html: string): { price?: number; originalPrice?: number } {
  const $ = cheerio.load(html);

  const fractionText = $(".ui-pdp-price__second-line .andes-money-amount__fraction")
    .first()
    .text()
    .replace(/\./g, "");
  const centsText =
    $(".ui-pdp-price__second-line .andes-money-amount__cents").first().text() || "00";

  let price: number | undefined;
  if (fractionText) {
    price = parseMoney(fractionText, centsText);
  }

  const previousContainer = $(".ui-pdp-price__second-line .andes-money-amount--previous").first();
  const previousFraction = previousContainer
    .find(".andes-money-amount__fraction")
    .first()
    .text()
    .replace(/\./g, "");
  const previousCents = previousContainer.find(".andes-money-amount__cents").first().text() || "00";

  let originalPrice: number | undefined;
  if (previousFraction) {
    const parsed = parseMoney(previousFraction, previousCents);
    if (!Number.isNaN(parsed) && parsed > 0) {
      originalPrice = parsed;
    }
  }

  return { price, originalPrice };
}

/** Extrai até `limit` resultados (título + url) da página de busca. */
export function parseSearchResults(html: string, limit = 10): SearchResultItem[] {
  const $ = cheerio.load(html);
  const results: SearchResultItem[] = [];

  $("li.ui-search-layout__item").each((_i, el) => {
    if (results.length >= limit) return false;

    const title =
      $(el).find("h2.ui-search-item__title").first().text().trim() ||
      $(el).find("h2").first().text().trim();

    const url =
      $(el).find("a.ui-search-link").attr("href") ||
      $(el).find("a").first().attr("href");

    if (title && url) {
      results.push({ title, url });
    }
  });

  return results;
}

// ── Orquestradores (fetch + parse) ───────────────────────────────────────────

/** Busca no Mercado Livre e retorna o preço do primeiro resultado. */
export async function scrapeMercadoLivrePrice(searchQuery: string): Promise<ScrapedPriceResult> {
  const searchUrl = buildSearchUrl(searchQuery);
  const listHtml = await fetchHtml(searchUrl);
  const listing = parseListingPrice(listHtml);

  const result: ScrapedPriceResult = {
    price: listing.price,
    currency: listing.currency,
    title: listing.title,
    url: listing.url || searchUrl,
  };

  // Best-effort: refina preço atual/anterior na página do anúncio.
  if (listing.url) {
    try {
      const detailHtml = await fetchHtml(listing.url, { retries: 1 });
      const detail = parseDetailPrice(detailHtml);
      if (detail.price != null) result.price = detail.price;
      if (detail.originalPrice != null) result.originalPrice = detail.originalPrice;
    } catch (err) {
      console.warn(
        "[Scraper] Falha ao ler página de anúncio, usando preço da lista.",
        err instanceof Error ? err.message : err
      );
    }
  }

  return result;
}

/** Retorna até `limit` resultados da página de busca (sem entrar em cada anúncio). */
export async function searchMercadoLivre(
  searchQuery: string,
  limit = 10
): Promise<SearchResultItem[]> {
  const html = await fetchHtml(buildSearchUrl(searchQuery));
  return parseSearchResults(html, limit);
}
