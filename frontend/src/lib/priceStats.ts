import type { PriceHistoryItem } from "../types";

export interface PriceStats {
  /** Último preço registrado */
  current: number | null;
  /** Menor preço do histórico */
  min: number | null;
  /** Maior preço do histórico */
  max: number | null;
  /** Preço médio do histórico */
  avg: number | null;
  /** Variação % do preço atual vs. o registro anterior */
  changePct: number | null;
  /** true se o preço atual é o menor já registrado */
  isLowestEver: boolean;
}

const EMPTY: PriceStats = {
  current: null,
  min: null,
  max: null,
  avg: null,
  changePct: null,
  isLowestEver: false,
};

/** Calcula estatísticas de preço a partir do histórico (ordem cronológica). */
export function computePriceStats(history: PriceHistoryItem[]): PriceStats {
  if (history.length === 0) return EMPTY;

  const prices = history.map((item) => item.discountedPrice);
  const current = prices[prices.length - 1];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;

  const previous = prices.length > 1 ? prices[prices.length - 2] : null;
  const changePct =
    previous && previous > 0 ? ((current - previous) / previous) * 100 : null;

  return { current, min, max, avg, changePct, isLowestEver: current <= min };
}
