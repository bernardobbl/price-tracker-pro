/**
 * Aritmética de vigência de assinatura — funções puras, sem I/O.
 *
 * Especificação completa em `docs/vigencia-do-acesso.md`. O resumo do que
 * importa aqui:
 *
 *  • Mês de CALENDÁRIO, não "30 dias". 31/jan + 1 mês = 28/fev (clamp no último
 *    dia do mês). Somar dias fixos daria menos tempo que o vendido em 7 dos 12
 *    meses, e 12 mensais (360 dias) não fechariam com o anual (365).
 *  • Renovar antes de vencer SOMA ao saldo: a base é o vencimento atual, não
 *    "agora". Sem isso a pessoa perde os dias que já pagou.
 *  • O corte é estrito: o acesso vale enquanto `agora < expiresAt`.
 *
 * Tudo trabalha em UTC. Quem gera o "agora" é o servidor — nunca o cliente.
 */

export type PlanKey = "mensal" | "anual";

/** Quantos meses de calendário cada plano concede. */
export const PLAN_MONTHS: Record<PlanKey, number> = {
  mensal: 1,
  anual: 12,
};

/** Preço em centavos. O backend é a ÚNICA fonte de verdade do valor. */
export const PLAN_PRICE_CENTS: Record<PlanKey, number> = {
  mensal: 1690,
  anual: 5990,
};

export function isPlanKey(value: unknown): value is PlanKey {
  return value === "mensal" || value === "anual";
}

/** Último dia de um mês (1-12) — trata ano bissexto. */
function daysInMonth(year: number, month1to12: number): number {
  // Dia 0 do mês seguinte = último dia deste mês.
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/**
 * Soma meses de calendário preservando o dia, com clamp no último dia do mês
 * de destino quando o dia não existe lá.
 *
 *   addCalendarMonths(31/jan, 1)      → 28/fev (ou 29 em bissexto)
 *   addCalendarMonths(31/mar, 1)      → 30/abr
 *   addCalendarMonths(29/fev/2028, 12)→ 28/fev/2029
 *   addCalendarMonths(14/ago, 1)      → 14/set
 *
 * Hora, minuto, segundo e milissegundo são preservados: a vigência acaba no
 * mesmo horário do dia, não à meia-noite.
 */
export function addCalendarMonths(from: Date, months: number): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth(); // 0-11
  const day = from.getUTCDate();

  const totalMonths = month + months;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12; // normaliza negativo

  const lastDay = daysInMonth(targetYear, targetMonth + 1);
  const targetDay = Math.min(day, lastDay); // ← o clamp

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      targetDay,
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds()
    )
  );
}

export interface ComputeExpiryInput {
  plan: PlanKey;
  /** Momento da confirmação do pagamento (relógio do servidor). */
  now: Date;
  /**
   * Vencimento da assinatura ativa atual, se houver. Quando ainda vigente, a
   * nova vigência é somada a ele — e não a `now` — para a pessoa não perder os
   * dias que já pagou.
   */
  currentExpiresAt?: Date | null;
}

/**
 * Calcula o novo vencimento.
 *
 * Regra: `base = MAX(now, currentExpiresAt)` e então soma os meses do plano.
 * Se a assinatura anterior já venceu, a base é `now` — não há crédito
 * retroativo por período parado.
 */
export function computeExpiresAt({ plan, now, currentExpiresAt }: ComputeExpiryInput): Date {
  const base =
    currentExpiresAt && currentExpiresAt.getTime() > now.getTime() ? currentExpiresAt : now;

  return addCalendarMonths(base, PLAN_MONTHS[plan]);
}

/**
 * O acesso está valendo neste instante?
 *
 * Corte estrito: no instante exato do vencimento, acabou. É o que "exatamente
 * 1 mês" significa — sem tolerância, sem "até a meia-noite".
 */
export function isWithinPeriod(now: Date, expiresAt: Date): boolean {
  return now.getTime() < expiresAt.getTime();
}

/**
 * Reembolso proporcional do anual: devolve os **meses inteiros** ainda não
 * usados, que é o que a Política de Reembolso promete por escrito.
 *
 *   cancelou no 4º mês → 8 meses restantes → 5990 * 8 / 12 = 3993 (R$ 39,93)
 *
 * Retorna centavos, arredondado. Nunca passa do valor pago nem fica negativo.
 */
export function computeProRataRefundCents(params: {
  plan: PlanKey;
  amountPaidCents: number;
  now: Date;
  expiresAt: Date;
}): number {
  const { plan, amountPaidCents, now, expiresAt } = params;
  const totalMonths = PLAN_MONTHS[plan];

  // Conta quantos meses inteiros ainda cabem entre agora e o vencimento.
  let wholeMonthsLeft = 0;
  while (
    wholeMonthsLeft < totalMonths &&
    addCalendarMonths(now, wholeMonthsLeft + 1).getTime() <= expiresAt.getTime()
  ) {
    wholeMonthsLeft += 1;
  }

  if (wholeMonthsLeft <= 0) return 0;

  const refund = Math.round((amountPaidCents * wholeMonthsLeft) / totalMonths);
  return Math.min(Math.max(refund, 0), amountPaidCents);
}
