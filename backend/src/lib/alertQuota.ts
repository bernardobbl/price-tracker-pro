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

// ═══════════════════════════════════════════════════════════════════════════
// A COTA NA HORA DE DISPARAR — e não só na hora de criar
//
// `decideAlertQuota` acima protege a CRIAÇÃO. Durante meses foi a única
// checagem que existiu, e isso deixava um vazamento silencioso do tamanho do
// produto inteiro:
//
//   1. a pessoa assina, cria 6 alertas (permitido, é ilimitado);
//   2. a assinatura vence e ninguém renova;
//   3. o `PlanBadge` volta a dizer "plano gratuito", o `POST /alerts` volta a
//      barrar no segundo — e **os 6 alertas continuam disparando por e-mail,
//      toda semana, para sempre**.
//
// O que o Premium vende, segundo a própria landing, é *ser avisado sem precisar
// voltar no site*. Continuar avisando depois do vencimento é entregar de graça
// exatamente aquilo que se cobra — e o formato da falha é o de sempre: nada
// quebra, nenhum log reclama, e o único sintoma é receita que não aparece.
//
// A regra aplicada aqui é a mesma do gate de criação, sem invenção: assinante
// dispara tudo; quem está no gratuito dispara `FREE_ALERT_LIMIT` alertas. Os
// demais ficam **dormentes, não apagados** — o dado é da pessoa, ela pode
// renovar amanhã, e apagar alerta por causa de vencimento seria destruir
// configuração alheia sem pedir.
// ═══════════════════════════════════════════════════════════════════════════

/** O mínimo que o corte por cota precisa saber sobre um alerta. */
export interface AlertForQuota {
  id: string;
  user_id: string;
  /** Usado para decidir QUAIS alertas sobrevivem. Ausente vai para o fim. */
  created_at?: string | null;
}

export interface QuotaSplit<T> {
  /** Alertas que devem ser avaliados nesta rodada. */
  kept: T[];
  /** Alertas dormentes por falta de plano — não são apagados, só ignorados. */
  skipped: T[];
}

/**
 * Separa os alertas que o plano de cada dono ainda sustenta.
 *
 * **Quais sobrevivem quando a cota aperta: os mais antigos.** É a única ordem
 * que a pessoa consegue prever sem abrir o banco — o primeiro alerta que ela
 * criou é o que ela mais provavelmente ainda quer. Escolher os mais recentes
 * faria o alerta principal calar por causa de um teste feito no mês passado, e
 * escolher "o mais barato" ou "o mais perto do alvo" seria o app decidindo por
 * ela qual combustível importa.
 *
 * Empate de `created_at` (ou data ausente) é desempatado pelo `id`, para a
 * função ser **determinística**: sem isso, a mesma entrada poderia calar
 * alertas diferentes a cada semana, conforme a ordem que o banco devolvesse.
 *
 * Função pura de propósito — a decisão de quem recebe e-mail é exatamente o
 * tipo de regra que precisa ser testável sem banco, sem SMTP e sem relógio.
 */
export function splitAlertsByQuota<T extends AlertForQuota>(
  alerts: readonly T[],
  paidUserIds: ReadonlySet<string>
): QuotaSplit<T> {
  const porDono = new Map<string, T[]>();
  for (const alerta of alerts) {
    const lista = porDono.get(alerta.user_id);
    if (lista) lista.push(alerta);
    else porDono.set(alerta.user_id, [alerta]);
  }

  const kept: T[] = [];
  const skipped: T[] = [];

  for (const [userId, doDono] of porDono) {
    if (paidUserIds.has(userId)) {
      kept.push(...doDono);
      continue;
    }

    const ordenados = [...doDono].sort((a, b) => {
      const ta = a.created_at ? Date.parse(a.created_at) : Number.NaN;
      const tb = b.created_at ? Date.parse(b.created_at) : Number.NaN;
      // Data ausente/inválida vai para o fim: quem tem data conhecida é mais
      // confiável para decidir "o mais antigo".
      const va = Number.isNaN(ta) ? Number.POSITIVE_INFINITY : ta;
      const vb = Number.isNaN(tb) ? Number.POSITIVE_INFINITY : tb;
      if (va !== vb) return va - vb;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    kept.push(...ordenados.slice(0, FREE_ALERT_LIMIT));
    skipped.push(...ordenados.slice(FREE_ALERT_LIMIT));
  }

  return { kept, skipped };
}
