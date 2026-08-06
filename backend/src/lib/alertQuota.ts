/**
 * Cota de alertas por plano — decisão pura, sem I/O.
 *
 * Separado do serviço de propósito: a regra de "quantos alertas cabem" é a
 * peça que muda de valor, e testá-la isolada é barato.
 *
 * ## Por que o gratuito é 1, e não 2 ou 3 (decidido em 05/ago/2026)
 *
 * O motorista de carro flex — o caso mais comum do Brasil — quer comparar
 * **gasolina e etanol**. Isso são dois alertas. Um limite de 2 cobriria
 * exatamente esse caso e ninguém encostaria nele: o plano pago existiria no
 * papel e não na prática. Um limite de 3 seria decorativo.
 *
 * Com 1, a fronteira cai num lugar honesto e fácil de explicar: **acompanhe um
 * combustível de graça; para comparar dois, ou seguir mais de uma cidade,
 * assine**. Quem só quer saber da gasolina do bairro continua atendido sem
 * pagar nada, e quem tem a necessidade maior encontra o motivo sozinho.
 *
 * ## O que deliberadamente NÃO é limitado
 *
 * **Consulta de preço.** É pública e sem login, e é o que o README vende como
 * diferencial (comparando com CamelCamelCamel/Keepa). Limitar busca afastaria
 * justamente quem chega para avaliar o projeto, e contar consultas de visitante
 * anônimo exigiria guardar algo por pessoa — que a Política de Privacidade diz
 * que não fazemos.
 *
 * **Favoritos.** Salvar uma série não custa nada e é o que dá utilidade diária
 * ao app. Apertar os dois eixos ao mesmo tempo faria o plano gratuito parecer
 * uma demonstração travada.
 *
 * O que se paga, portanto, é **ser avisado sem precisar voltar no site** — que
 * é exatamente a promessa da landing.
 */

/**
 * Quantos alertas o plano gratuito permite.
 *
 * ⚠️ **Este número só é seguro porque quem conta sabe dizer "não sei".** A
 * contagem vem do `countFuelAlerts`, que devolve `null` quando o banco não
 * responde, e o chamador **recusa** nesse caso. Se um dia alguém trocar a
 * contagem por `listFuelAlerts().length`, a cota volta a liberar tudo sempre
 * que o Supabase estiver fora — lista vazia é indistinguível de zero alertas.
 */
export const FREE_ALERT_LIMIT = 1;

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

  // A mensagem diz o que a pessoa TEM, não só o que ela não pode: quem bateu no
  // limite continua com um alerta funcionando, e pode trocar de série sem pagar
  // nada. Recusa que só nega vira sensação de armadilha.
  return {
    allowed: false,
    limit,
    reason:
      `O plano gratuito acompanha ${limit} ${limit === 1 ? "série" : "séries"}. ` +
      `Você pode trocar a série do alerta que já tem, ou assinar o Premium para ` +
      `acompanhar quantas quiser.`,
  };
}
