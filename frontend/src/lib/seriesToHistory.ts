import type { FuelSeriesPoint, PriceHistoryItem } from "../types";

/** URL pública da série histórica da ANP (fonte dos dados). */
export const ANP_SOURCE_URL =
  "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/serie-historica-de-precos-de-combustiveis";

/**
 * Adapta a série de combustível (média diária por município) para o formato
 * `PriceHistoryItem` genérico consumido pelas libs de inteligência e pelo gráfico.
 * O "preço" de cada ponto é a **média do dia** — é o número que o produto rastreia.
 */
export function seriesToHistory(
  series: FuelSeriesPoint[],
  label: string,
  currency = "R$"
): PriceHistoryItem[] {
  return series.map((p) => ({
    date: p.date,
    fullPrice: p.avgPrice,
    discountedPrice: p.avgPrice,
    currency,
    title: label,
    url: ANP_SOURCE_URL,
  }));
}
