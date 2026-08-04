/**
 * Cota de alertas por plano — decisão pura, sem I/O.
 *
 * Separado do serviço de propósito: a regra de "quantos alertas cabem" é a
 * peça que vai mudar de valor quando o plano grátis for limitado, e testá-la
 * isolada é barato.
 *
 * ⚠️ ESTADO ATUAL (04/ago/2026): `FREE_ALERT_LIMIT = Infinity`.
 * O grátis continua ilimitado, exatamente como hoje — **nenhum comportamento
 * muda com este commit**. A infraestrutura do gate fica pronta e a limitação
 * passa a ser a troca de um número.
 *
 * Para ligar a limitação depois, troque para o valor desejado (ex.: 2) e
 * ANTES disso confira a landing: ela hoje vende "alertas ilimitados" como
 * benefício do Premium, e é isso que dá razão de existir ao plano pago.
 * Ver docs/runbook-operacao.md §5.
 */

/**
 * Quantos alertas o plano gratuito permite. `Infinity` = sem limite.
 *
 * ⚠️ **Ao trocar por um número finito, confira o caminho sem Supabase.** Quem
 * conta os alertas existentes é `listFuelAlerts`, que devolve `[]` quando o
 * Supabase não está configurado — então a contagem viria 0 e a cota liberaria
 * sempre. Hoje isso é inofensivo (sem Supabase também não dá para criar alerta
 * nenhum), mas vira falha aberta no dia em que o limite existir de verdade.
 */
export const FREE_ALERT_LIMIT = Number.POSITIVE_INFINITY;

/** O plano pago é ilimitado — é o que a landing promete. */
export const PAID_ALERT_LIMIT = Number.POSITIVE_INFINITY;

export interface AlertQuotaInput {
  /** Assinatura paga valendo agora? */
  hasActiveSubscription: boolean;
  /** Quantos alertas o usuário já tem. */
  currentCount: number;
}

export interface AlertQuotaDecision {
  allowed: boolean;
  limit: number;
  /** Mensagem para o usuário quando bloqueado. Vazia quando permitido. */
  reason: string;
}

/**
 * Pode criar mais um alerta?
 *
 * Atualização de alerta existente não consome cota — quem chama precisa passar
 * `currentCount` já sabendo disso (o `createOrUpdateFuelAlert` faz upsert por
 * `user_id + series_id + channel`, então atualizar não cria linha nova).
 */
export function decideAlertQuota({
  hasActiveSubscription,
  currentCount,
}: AlertQuotaInput): AlertQuotaDecision {
  const limit = hasActiveSubscription ? PAID_ALERT_LIMIT : FREE_ALERT_LIMIT;

  if (currentCount < limit) {
    return { allowed: true, limit, reason: "" };
  }

  return {
    allowed: false,
    limit,
    reason:
      `O plano gratuito permite ${limit} ${limit === 1 ? "alerta" : "alertas"}. ` +
      `Assine o Premium para criar quantos quiser.`,
  };
}
