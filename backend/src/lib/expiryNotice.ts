/**
 * Aviso de vencimento da assinatura — decisão e conteúdo, ambos puros.
 *
 * Por que isto existe: os Termos e o checkout **prometem por escrito** que
 * avisamos antes de vencer. Como não há renovação automática (o Banco Central
 * exige CNPJ para receber Pix Automático), esse aviso é a única coisa que
 * impede o cliente de perder acesso sem entender por quê — a falha mais
 * silenciosa e mais danosa do sistema.
 *
 * ⚠️ A JANELA É DE 8 DIAS, NÃO 7. O job que dispara isto roda **semanalmente**
 * (segunda 06:00). Com janela de 7 dias, uma assinatura que vence 7,5 dias
 * depois de uma execução não seria pega naquela rodada nem na seguinte — ela
 * escaparia pelo vão. Um dia de folga garante que toda assinatura caia em pelo
 * menos uma varredura antes de vencer. O `warnedAt` impede o aviso duplicado
 * quando ela cai em duas.
 */

import type { PlanKey } from "./subscriptionPeriod";

/** Folga sobre os 7 dias prometidos, calibrada para a cadência semanal do job. */
export const NOTICE_WINDOW_DAYS = 8;

const MS_PER_DAY = 86_400_000;

export interface SubscriptionForNotice {
  id: string;
  userId: string;
  email: string;
  plan: PlanKey;
  expiresAt: Date;
  warnedAt: Date | null;
}

/**
 * Quem deve receber aviso agora.
 *
 * Três filtros, nesta ordem:
 *
 *  1. **Uma linha por usuário — a de maior vigência.** Renovação cria uma linha
 *     nova; a antiga continua `active` com vencimento anterior. Sem este passo,
 *     quem acabou de renovar receberia um aviso de vencimento pela linha velha,
 *     que é exatamente o oposto do que o aviso serve.
 *  2. **Ainda não avisado** (`warnedAt` nulo). Como a linha nova nasce sem
 *     `warnedAt`, quem renova volta a ser elegível no ciclo seguinte — o que é
 *     o comportamento correto.
 *  3. **Vence dentro da janela** e ainda não venceu. Já vencida não recebe
 *     aviso: perdeu a função, e avisar depois só irrita.
 */
export function selectSubscriptionsToWarn(params: {
  subscriptions: SubscriptionForNotice[];
  now: Date;
  windowDays?: number;
}): SubscriptionForNotice[] {
  const { subscriptions, now, windowDays = NOTICE_WINDOW_DAYS } = params;
  const limit = new Date(now.getTime() + windowDays * MS_PER_DAY);

  // 1. só a assinatura de maior vigência de cada usuário
  const latestByUser = new Map<string, SubscriptionForNotice>();
  for (const sub of subscriptions) {
    const current = latestByUser.get(sub.userId);
    if (!current || sub.expiresAt.getTime() > current.expiresAt.getTime()) {
      latestByUser.set(sub.userId, sub);
    }
  }

  return [...latestByUser.values()]
    .filter((sub) => sub.warnedAt === null)
    .filter(
      (sub) =>
        sub.expiresAt.getTime() > now.getTime() && sub.expiresAt.getTime() <= limit.getTime()
    )
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
}

/** Dias inteiros que faltam para vencer (para o texto do e-mail). */
export function daysUntil(now: Date, expiresAt: Date): number {
  return Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / MS_PER_DAY));
}

export interface ExpiryNoticeContent {
  subject: string;
  text: string;
}

/**
 * Assunto e corpo do aviso.
 *
 * O tom é deliberadamente tranquilo: a pessoa **não** vai ser cobrada, não vai
 * perder nada do que salvou, e não precisa fazer nada se não quiser. Aviso de
 * vencimento escrito com urgência artificial vira spam na cabeça de quem lê.
 */
export function montarConteudoVencimento(params: {
  plan: PlanKey;
  expiresAt: Date;
  now: Date;
  /** URL do app, para o link de renovação. Sem ela o e-mail sai sem link. */
  appUrl?: string | null;
}): ExpiryNoticeContent {
  const { plan, expiresAt, now, appUrl } = params;

  const dias = daysUntil(now, expiresAt);
  const dataBR = expiresAt.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });

  const quando =
    dias === 0 ? "hoje" : dias === 1 ? "amanhã" : `em ${dias} dias`;
  const nomePlano = plan === "anual" ? "anual" : "mensal";

  const subject = `Seu acesso Premium vence ${quando} (${dataBR})`;

  const linhas = [
    `Oi!`,
    ``,
    `Seu plano ${nomePlano} do Price Tracker Pro vence ${quando}, em ${dataBR}.`,
    ``,
    `Não existe cobrança automática por aqui — nada será debitado de você.`,
    `Se quiser continuar com o Premium, é só renovar quando puder.`,
    ``,
  ];

  if (appUrl) {
    linhas.push(`Renovar: ${appUrl.replace(/\/$/, "")}/premium`, ``);
  }

  linhas.push(
    `Se preferir não renovar, tudo bem: sua conta volta ao uso gratuito e você`,
    `continua com seus favoritos e seu histórico. Nada é apagado.`,
    ``,
    `— Price Tracker Pro`
  );

  return { subject, text: linhas.join("\n") };
}
