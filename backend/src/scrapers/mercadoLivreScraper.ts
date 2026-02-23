import axios from "axios";
import * as cheerio from "cheerio";

export interface ScrapedPriceResult {
  // Preço principal exibido (geralmente com desconto)
  price: number;
  // Preço cheio/anterior, se disponível
  originalPrice?: number;
  currency: string;
  title: string;
  url: string;
}

// Faz busca no Mercado Livre e pega o primeiro resultado
export async function scrapeMercadoLivrePrice(searchQuery: string): Promise<ScrapedPriceResult> {
  const searchUrl = `https://lista.mercadolivre.com.br/${encodeURIComponent(searchQuery)}`;

  const response = await axios.get(searchUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
    }
  });

  const $ = cheerio.load(response.data);

  // Seletores podem mudar com o tempo – aqui é um chute razoável baseado na estrutura atual
  const firstItem =
    $("li.ui-search-layout__item").first() ||
    $("li.ui-search-layout__item.ui-search-layout__item--stack").first();

  const title =
    firstItem.find("h2.ui-search-item__title").first().text().trim() ||
    firstItem.find("h2").first().text().trim();

  // tenta pegar qualquer link de produto dentro do card; se não achar, usa a URL de busca
  const link =
    firstItem.find("a.ui-search-link").attr("href") ||
    firstItem.find("a").first().attr("href") ||
    searchUrl;

  // Preço principal (normalmente com desconto)
  const fractionText = firstItem.find(".andes-money-amount__fraction").first().text().replace(/\./g, "");
  const centsText = firstItem.find(".andes-money-amount__cents").first().text() || "00";
  const currencySymbol = firstItem.find(".andes-money-amount__currency-symbol").first().text().trim() || "R$";

  if (!fractionText) {
    throw new Error("Não foi possível encontrar o preço no HTML do Mercado Livre.");
  }

  const listPagePrice = parseFloat(`${fractionText},${centsText}`.replace(".", "").replace(",", "."));

  let price = listPagePrice;
  let originalPrice: number | undefined;

  // Tenta capturar preços mais precisos na página do anúncio
  try {
    const detailResp = await axios.get(link, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
      }
    });

    const detail$ = cheerio.load(detailResp.data);

    // Preço atual (com desconto) na página do anúncio
    const detailPriceElement = detail$(".ui-pdp-price__second-line .andes-money-amount__fraction").first();
    const detailFractionText = detailPriceElement.text().replace(/\./g, "");
    const detailCentsText =
      detail$(".ui-pdp-price__second-line .andes-money-amount__cents").first().text() || "00";

    if (detailFractionText) {
      price = parseFloat(
        `${detailFractionText},${detailCentsText}`.replace(".", "").replace(",", ".")
      );
    }

    // Preço cheio/anterior (quando há desconto) na página do anúncio
    const previousPriceContainer =
      detail$(".ui-pdp-price__second-line .andes-money-amount--previous").first() ||
      detail$(".andes-money-amount--previous").first();

    const previousFractionText = previousPriceContainer
      .find(".andes-money-amount__fraction")
      .first()
      .text()
      .replace(/\./g, "");
    const previousCentsText =
      previousPriceContainer.find(".andes-money-amount__cents").first().text() || "00";

    if (previousFractionText) {
      const parsedOriginal = parseFloat(
        `${previousFractionText},${previousCentsText}`.replace(".", "").replace(",", ".")
      );
      if (!Number.isNaN(parsedOriginal) && parsedOriginal > 0) {
        originalPrice = parsedOriginal;
      }
    }
  } catch (err) {
    console.warn("[Scraper] Falha ao ler página de anúncio, usando apenas preço da lista.", err);
  }

  return {
    price,
    originalPrice,
    currency: currencySymbol,
    title,
    url: link
  };
}

