import type { PriceStats } from "./priceStats";

export type DealTone = "success" | "warning" | "danger" | "muted";

export interface DealSignal {
  /** Score de 0 a 100 — quanto maior, melhor o momento de compra. */
  score: number;
  /** Rótulo curto para o usuário (ex: "Compre já"). */
  label: string;
  /** Frase de apoio explicando o porquê. */
  hint: string;
  /** Tom semântico para estilização. */
  tone: DealTone;
  /** Posição do preço atual entre o menor (0%) e o maior (100%) histórico. */
  positionPct: number;
  /** false quando não há dados suficientes para um sinal. */
  available: boolean;
}

const UNAVAILABLE: DealSignal = {
  score: 0,
  label: "Sem dados",
  hint: "Aguardando histórico suficiente.",
  tone: "muted",
  positionPct: 0,
  available: false,
};

/**
 * Deriva um "sinal de compra" a partir das estatísticas de preço.
 * Regra simples e transparente (sem ML): compara o preço atual com o menor,
 * o maior e a média do histórico. Perto do mínimo → melhor momento.
 */
export function computeDealSignal(stats: PriceStats): DealSignal {
  const { current, min, max, avg } = stats;

  if (current == null || min == null || max == null || avg == null) {
    return UNAVAILABLE;
  }

  const range = max - min;

  // Sem variação no histórico: não há o que decidir.
  if (range <= 0) {
    return {
      score: 50,
      label: "Preço estável",
      hint: "O preço não variou no período.",
      tone: "muted",
      positionPct: 0,
      available: true,
    };
  }

  const position = (current - min) / range; // 0 = no menor preço, 1 = no maior
  const positionPct = Math.round(position * 100);
  const score = Math.round((1 - position) * 100); // perto do mínimo → score alto

  let label: string;
  let hint: string;
  let tone: DealTone;

  if (current <= min) {
    label = "Compre já";
    hint = "Menor preço já registrado.";
    tone = "success";
  } else if (current < avg) {
    label = "Bom preço";
    hint = "Abaixo da média do período.";
    tone = "success";
  } else if (current <= avg * 1.05) {
    label = "Preço mediano";
    hint = "Em torno da média — dá pra esperar.";
    tone = "warning";
  } else {
    label = "Espere cair";
    hint = "Acima da média do período.";
    tone = "danger";
  }

  return { score, label, hint, tone, positionPct, available: true };
}
