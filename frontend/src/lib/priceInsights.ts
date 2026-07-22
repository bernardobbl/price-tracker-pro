import type { PriceHistoryItem } from "../types";
import type { PriceStats } from "./priceStats";

export type Period = "30d" | "90d" | "6m" | "all";

export const PERIODS: { value: Period; label: string }[] = [
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
  { value: "6m", label: "6 meses" },
  { value: "all", label: "Tudo" }
];

const DAY_MS = 86_400_000;

/**
 * Filtra o histórico por período, ancorado na data do registro mais recente
 * (e não em "agora", pois os dados podem ser históricos/seedados).
 * Se o recorte ficar vazio, devolve o histórico inteiro (fallback seguro).
 */
export function filterByPeriod(
  history: PriceHistoryItem[],
  period: Period
): PriceHistoryItem[] {
  if (period === "all" || history.length === 0) return history;

  const days = period === "30d" ? 30 : period === "90d" ? 90 : 180;
  const anchor = new Date(history[history.length - 1].date).getTime();
  const cutoff = anchor - days * DAY_MS;

  const filtered = history.filter((h) => new Date(h.date).getTime() >= cutoff);
  return filtered.length > 0 ? filtered : history;
}

export type TrendDir = "up" | "down" | "flat";

export interface Trend {
  dir: TrendDir;
  label: string;
  changePct: number;
  available: boolean;
}

const TREND_UNAVAILABLE: Trend = { dir: "flat", label: "—", changePct: 0, available: false };

/**
 * Tendência de curto prazo por média móvel: compara a média dos últimos `window`
 * pontos com a dos `window` anteriores. Sem ML — só uma leitura de direção.
 */
export function computeTrend(history: PriceHistoryItem[], window = 5): Trend {
  const prices = history.map((h) => h.discountedPrice);
  if (prices.length < 4) return TREND_UNAVAILABLE;

  const k = Math.min(window, Math.floor(prices.length / 2));
  const recent = prices.slice(-k);
  const prior = prices.slice(-2 * k, -k);

  const mean = (arr: number[]) => arr.reduce((s, p) => s + p, 0) / arr.length;
  const recentAvg = mean(recent);
  const priorAvg = mean(prior);
  if (priorAvg <= 0) return TREND_UNAVAILABLE;

  const changePct = ((recentAvg - priorAvg) / priorAvg) * 100;

  if (Math.abs(changePct) < 1.5) {
    return { dir: "flat", label: "Estável", changePct, available: true };
  }
  return changePct > 0
    ? { dir: "up", label: "Subindo", changePct, available: true }
    : { dir: "down", label: "Caindo", changePct, available: true };
}

export interface Volatility {
  level: string;
  pct: number;
  available: boolean;
}

/**
 * Volatilidade = amplitude relativa (max - min) / média, em %.
 * Baixa (<8%), Média (<20%) ou Alta (>=20%).
 */
export function computeVolatility(stats: PriceStats): Volatility {
  const { min, max, avg } = stats;
  if (min == null || max == null || avg == null || avg <= 0) {
    return { level: "—", pct: 0, available: false };
  }

  const pct = ((max - min) / avg) * 100;
  const level = pct < 8 ? "Baixa" : pct < 20 ? "Média" : "Alta";
  return { level, pct, available: true };
}
