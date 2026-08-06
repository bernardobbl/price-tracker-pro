/**
 * Orquestração da cobrança: criar, confirmar e virar assinatura.
 *
 * Regras de ouro deste arquivo, todas com motivo:
 *
 *  1. **O preço vem do plano, nunca do cliente.** Se o valor viesse do front,
 *     qualquer um pagaria R$ 0,01 pelo anual.
 *  2. **A verdade sobre um pagamento vem da API, nunca do webhook.** O webhook
 *     é só um aviso de "algo mudou". Confiar no corpo dele significaria que
 *     quem descobrisse a URL poderia liberar acesso de graça.
 *  3. **Sem usuário identificado, não há assinatura.** A coluna `user_id` é
 *     nullable por causa da anonimização (LGPD), então o banco aceitaria uma
 *     linha órfã sem reclamar — em produção isso seria dinheiro recebido sem
 *     ninguém liberado. Recusamos aqui, no código.
 *  4. **Idempotência em duas camadas:** índice único no banco e verificação
 *     antes de inserir. O webhook chega repetido; sem isso, a vigência dobra.
 *  5. **O valor pago é conferido contra o valor cobrado.** O snapshot da order
 *     já traz o total; comparar custa uma linha e troca confiança por
 *     verificação. Divergência vira alarme, não assinatura.
 */

import { supabase } from "../config/supabaseClient";
import { logger } from "../lib/logger";
import {
  computeExpiresAt,
  computeProRataRefundCents,
  PLAN_PRICE_CENTS,
  type PlanKey,
} from "../lib/subscriptionPeriod";
import {
  createPixOrder,
  getOrder,
  refundOrder,
  type NormalizedStatus,
} from "./mercadoPagoClient";
import { getActiveSubscription } from "./subscriptionService";

export class BillingError extends Error {
  code:
    | "NOT_CONFIGURED"
    | "CHARGE_NOT_FOUND"
    | "USER_REQUIRED"
    | "ALREADY_PROCESSED"
    | "AMOUNT_MISMATCH"
    | "PROVIDER_FAILED";

  constructor(code: BillingError["code"], message: string) {
    super(message);
    this.name = "BillingError";
    this.code = code;
  }
}

/** Validade do QR. Curta o bastante para não acumular pendência eterna. */
const QR_EXPIRES_MINUTES = 30;

export interface CreateChargeInput {
  userId: string;
  plan: PlanKey;
  email: string;
  legalVersion: string;
}

export interface CreatedCharge {
  chargeId: string;
  amountCents: number;
  brCode: string;
  brCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: string;
  /**
   * `test` ou `production`. Vai para a tela porque um código de sandbox **não
   * é pagável** — e sem avisar, o checkout mostra um QR que o banco recusa sem
   * nenhuma explicação. Não é segredo: quem está logado já poderia descobrir
   * tentando pagar.
   */
  environment: "test" | "production";
}

/**
 * Cria a cobrança: grava a linha `pending`, pede o QR ao provedor e devolve.
 *
 * A linha nasce **antes** da chamada externa de propósito. Assim o id dela pode
 * ir como `external_reference` e como chave de idempotência — e se a chamada
 * falhar, sobra uma linha pendente rastreável em vez de uma cobrança órfã no
 * provedor que ninguém sabe de quem é.
 */
export async function createCharge(input: CreateChargeInput): Promise<CreatedCharge> {
  if (!supabase) throw new BillingError("NOT_CONFIGURED", "Supabase não configurado.");

  const amountCents = PLAN_PRICE_CENTS[input.plan]; // ← preço decidido aqui
  const acceptedAt = new Date().toISOString(); // hora do servidor, não do cliente

  const { data: charge, error } = await supabase
    .from("billing_charges")
    .insert({
      user_id: input.userId,
      plan: input.plan,
      amount_cents: amountCents,
      status: "pending",
      legal_version: input.legalVersion,
      accepted_at: acceptedAt,
    })
    .select("id")
    .single();

  if (error || !charge) {
    logger.error({ err: error?.message }, "[Billing] Falha ao criar cobrança");
    throw new BillingError("NOT_CONFIGURED", "Não foi possível registrar a cobrança.");
  }

  const chargeId = charge.id as string;

  try {
    const order = await createPixOrder({
      amountCents,
      externalReference: chargeId,
      payerEmail: input.email,
      expiresInMinutes: QR_EXPIRES_MINUTES,
    });

    await supabase
      .from("billing_charges")
      .update({ provider_order_id: order.orderId })
      .eq("id", chargeId);

    return {
      chargeId,
      amountCents,
      brCode: order.brCode,
      brCodeBase64: order.brCodeBase64,
      ticketUrl: order.ticketUrl,
      expiresAt: new Date(Date.now() + QR_EXPIRES_MINUTES * 60_000).toISOString(),
      // Default `test` quando o provedor não informa: na dúvida, a tela avisa
      // que o código pode não ser pagável. Errar para o lado do aviso é barato;
      // errar para o lado do silêncio é a pessoa achando que o banco quebrou.
      environment: order.environment ?? "test",
    };
  } catch (err) {
    // Marca a cobrança como cancelada para ela não ficar pendente para sempre.
    await supabase.from("billing_charges").update({ status: "cancelled" }).eq("id", chargeId);
    logger.error(
      { err: err instanceof Error ? err.message : String(err), chargeId },
      "[Billing] Provedor recusou a criação da cobrança"
    );
    throw new BillingError("PROVIDER_FAILED", "Não foi possível gerar o pagamento agora.");
  }
}

export interface ChargeStatus {
  chargeId: string;
  status: NormalizedStatus;
  plan: PlanKey;
  amountCents: number;
}

/**
 * Status da cobrança — é o que o polling da página consulta.
 *
 * **Reconcilia com o provedor quando ainda está pendente.** Não é otimização
 * prematura; resolve dois problemas concretos:
 *
 *  1. **Webhook perdido.** No free tier o backend hiberna; uma notificação que
 *     chegue nesse instante pode se perder mesmo com as retentativas. Sem
 *     reconciliação, quem pagou ficaria esperando para sempre.
 *  2. **Desenvolvimento local.** O Mercado Pago não alcança `localhost`, então
 *     em desenvolvimento o webhook **nunca** chega. Sem isto, seria impossível
 *     testar o fluxo completo sem montar um túnel público.
 *
 * O custo é uma chamada à API do provedor por polling, e é por isso que o
 * intervalo do checkout é uma **escada** (3s no 1º minuto → 10s até os 5 min →
 * 30s no resto), não um valor fixo: a 4s fixos seriam até 450 consultas por
 * tentativa de checkout, contra ~94 hoje. O porquê está em
 * `docs/auditoria-branch-checkout-pix.md` §1 — se algum dia esse ritmo mudar
 * no `checkout.html`, refaça a conta contra o rate-limit do `app.ts`.
 */
export async function getChargeStatus(
  chargeId: string,
  userId: string
): Promise<ChargeStatus | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("billing_charges")
    .select("id, status, plan, amount_cents, provider_order_id")
    .eq("id", chargeId)
    .eq("user_id", userId) // o backend ignora RLS: o filtro por dono é explícito
    .maybeSingle();

  if (error || !data) return null;

  let status = data.status as NormalizedStatus;
  const orderId = data.provider_order_id as string | null;

  if (status === "pending" && orderId) {
    try {
      const result = await confirmPaymentByOrderId(orderId);
      status = result.status;
    } catch (err) {
      // Reconciliar é oportunista: se o provedor estiver fora, devolvemos o
      // que temos em vez de quebrar a tela de quem está esperando.
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), chargeId },
        "[Billing] Reconciliação falhou — devolvendo status armazenado"
      );
    }
  }

  return {
    chargeId: data.id as string,
    status,
    plan: data.plan as PlanKey,
    amountCents: data.amount_cents as number,
  };
}

export interface ConfirmResult {
  /** `true` quando esta chamada criou a assinatura; `false` quando já existia. */
  created: boolean;
  status: NormalizedStatus;
  chargeId: string | null;
}

/**
 * Processa uma notificação do provedor.
 *
 * Recebe **apenas o id da order** — tudo o mais é reconsultado na API. Mesmo
 * que a requisição seja forjada, o pior que acontece é uma consulta a mais:
 * sem pagamento aprovado do lado do provedor, nada é liberado.
 */
export async function confirmPaymentByOrderId(orderId: string): Promise<ConfirmResult> {
  if (!supabase) throw new BillingError("NOT_CONFIGURED", "Supabase não configurado.");

  // 1. A verdade vem daqui, não do corpo do webhook.
  const snapshot = await getOrder(orderId);

  // 2. Localiza a nossa cobrança. `external_reference` é o caminho primário;
  //    `provider_order_id` é a rede de segurança caso a order chegue sem ele.
  const chargeId = snapshot.externalReference;
  const query = supabase
    .from("billing_charges")
    .select("id, user_id, plan, amount_cents, status, legal_version, accepted_at");

  const { data: charge, error } = chargeId
    ? await query.eq("id", chargeId).maybeSingle()
    : await query.eq("provider_order_id", orderId).maybeSingle();

  if (error || !charge) {
    logger.warn({ orderId, chargeId }, "[Billing] Notificação sem cobrança correspondente");
    throw new BillingError("CHARGE_NOT_FOUND", "Cobrança não encontrada.");
  }

  const id = charge.id as string;
  const userId = charge.user_id as string | null;
  const plan = charge.plan as PlanKey;

  // 3. Sem dono não há a quem liberar. O banco aceitaria (a coluna é nullable
  //    por causa da LGPD), então a recusa precisa ser aqui.
  if (!userId) {
    logger.error({ chargeId: id }, "[Billing] Cobrança sem usuário — assinatura não criada");
    throw new BillingError("USER_REQUIRED", "Cobrança sem usuário associado.");
  }

  // 4. Ainda não pago: registra o estado e sai sem liberar nada.
  if (snapshot.status !== "paid") {
    if (charge.status !== snapshot.status) {
      await supabase.from("billing_charges").update({ status: snapshot.status }).eq("id", id);
    }

    // Estorno feito FORA daqui (pelo painel do Mercado Pago, ou uma contestação
    // que virou chargeback) precisa cortar o acesso. Sem isto, a pessoa recebe o
    // dinheiro de volta e continua assinante — o runbook avisava exatamente
    // disso ("o estorno no painel não avisa o seu sistema") e a saída era um
    // UPDATE na mão, que só acontece se alguém lembrar.
    if (snapshot.status === "refunded") {
      await expireSubscriptionForCharge(id, "estorno detectado na consulta à order");
    }

    return { created: false, status: snapshot.status, chargeId: id };
  }

  // 5. Já processada? O webhook repete — esta é a 1ª camada de idempotência.
  if (charge.status === "paid") {
    return { created: false, status: "paid", chargeId: id };
  }

  // 6. O valor pago tem de ser o valor cobrado.
  //
  //    Na prática o Pix não permite pagar a menos: o QR carrega o valor da
  //    order que nós mesmos criamos. Mas o snapshot já traz o número, a
  //    comparação custa uma linha, e ela troca "confio que o provedor não
  //    mudou o valor" por "conferi". Se um dia a API passar a aceitar valor
  //    parcial, ou se uma order de outro ambiente cair aqui por engano, é este
  //    if que impede um mês de acesso vendido por qualquer preço.
  //
  //    Divergência não vira assinatura — vira alarme. `amountCents` nulo (a
  //    API não devolveu total) não bloqueia: não conseguir conferir é
  //    diferente de conferir e dar errado.
  const cobrado = charge.amount_cents as number;
  if (snapshot.amountCents != null && snapshot.amountCents !== cobrado) {
    logger.error(
      { chargeId: id, cobrado, pago: snapshot.amountCents, orderId },
      "[Billing] Valor pago diverge do cobrado — assinatura NÃO criada"
    );
    throw new BillingError(
      "AMOUNT_MISMATCH",
      "Valor pago não confere com o valor da cobrança."
    );
  }

  const now = new Date();

  // 7. Vigência somando o saldo restante, se houver assinatura ativa.
  const atual = await getActiveSubscription(userId, now);
  const expiresAt = computeExpiresAt({
    plan,
    now,
    currentExpiresAt: atual?.expiresAt ?? null,
  });

  // 8. Cria a assinatura. A 2ª camada de idempotência é o índice único em
  //    (provider, charge_id): se duas notificações correrem juntas, uma perde.
  const { error: subError } = await supabase.from("subscriptions").insert({
    user_id: userId,
    plan,
    status: "active",
    starts_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    provider: "mercadopago",
    charge_id: id,
    amount_cents: charge.amount_cents as number,
    paid_at: now.toISOString(),
    legal_version: charge.legal_version as string,
    accepted_at: charge.accepted_at as string,
  });

  if (subError) {
    // 23505 = unique_violation → a corrida foi perdida, e está tudo certo:
    // outra execução já criou a assinatura desta cobrança.
    if (subError.code === "23505") {
      logger.info({ chargeId: id }, "[Billing] Assinatura já existia (notificação repetida)");
      return { created: false, status: "paid", chargeId: id };
    }
    logger.error({ err: subError.message, chargeId: id }, "[Billing] Falha ao criar assinatura");
    throw new BillingError("PROVIDER_FAILED", "Falha ao registrar a assinatura.");
  }

  await supabase
    .from("billing_charges")
    .update({ status: "paid", paid_at: now.toISOString() })
    .eq("id", id);

  logger.info(
    { chargeId: id, plan, expiresAt: expiresAt.toISOString() },
    "[Billing] Assinatura criada a partir de pagamento confirmado"
  );

  return { created: true, status: "paid", chargeId: id };
}

// ═══════════════════════════════════════════════════════════════════════════
// ESTORNO E REEMBOLSO
//
// A Política de Reembolso já estava publicada prometendo três coisas, e até
// aqui nenhuma delas existia em código — só como SQL manual no runbook:
//
//   1. até 7 dias, devolução integral (art. 49 do CDC, direito irrenunciável);
//   2. depois disso, no anual, os meses inteiros não usados;
//   3. no mensal depois de 7 dias, nada — "o período é curto e já foi entregue".
//
// Duas decisões de desenho valem explicação.
//
// **Por que a matemática fica no backend e o valor é conferido.** O `POST` exige
// que quem chama informe o valor esperado, e ele tem de bater com o calculado.
// Não é burocracia: é a diferença entre "o sistema devolveu R$ 39,93" e "alguém
// digitou 3993 e o sistema obedeceu". Dinheiro saindo merece uma confirmação
// que não seja um clique.
//
// **Por que não é autoatendimento.** A política publicada diz que o cliente
// escreve um e-mail e nós respondemos em até 5 dias úteis. Um botão que devolve
// dinheiro sozinho, num sistema que nunca processou um estorno real, seria
// entregar mais do que foi prometido pelo caminho mais arriscado. O ganho que
// importa — a conta certa e o acesso cortado no mesmo instante — não depende de
// autoatendimento.
// ═══════════════════════════════════════════════════════════════════════════

/** Regra da política que se aplica ao caso. */
export type RefundRule =
  | "cdc-7-dias"      // devolução integral, sem discussão
  | "prorata-anual"   // meses inteiros não usados
  | "sem-reembolso";  // mensal fora dos 7 dias

export interface RefundPreview {
  chargeId: string;
  plan: PlanKey;
  amountPaidCents: number;
  paidAt: string | null;
  daysSincePayment: number | null;
  rule: RefundRule;
  /** Quanto devolver, em centavos, segundo a política. Pode ser 0. */
  refundCents: number;
  /** `true` quando o valor devolvido é o total pago (muda o corpo enviado ao provedor). */
  total: boolean;
  subscriptionId: string | null;
  expiresAt: string | null;
  /** Frase curta explicando a regra — vai para a resposta e para o email ao cliente. */
  explanation: string;
}

const MS_PER_DAY = 86_400_000;
/** Prazo de arrependimento do art. 49 do CDC: 7 dias corridos. */
const CDC_DAYS = 7;

/**
 * Calcula o que a política manda devolver — sem tocar em dinheiro.
 *
 * Existe separada da execução de propósito: dá para conferir a conta antes de
 * mandar, e o mesmo cálculo alimenta a confirmação exigida no `POST`.
 */
export async function previewRefund(chargeId: string, now: Date = new Date()): Promise<RefundPreview> {
  if (!supabase) throw new BillingError("NOT_CONFIGURED", "Supabase não configurado.");

  const { data: charge, error } = await supabase
    .from("billing_charges")
    .select("id, plan, amount_cents, status, paid_at")
    .eq("id", chargeId)
    .maybeSingle();

  if (error || !charge) throw new BillingError("CHARGE_NOT_FOUND", "Cobrança não encontrada.");

  if (charge.status === "refunded") {
    throw new BillingError("ALREADY_PROCESSED", "Esta cobrança já foi estornada.");
  }
  if (charge.status !== "paid") {
    throw new BillingError(
      "CHARGE_NOT_FOUND",
      `Só é possível estornar cobrança paga (esta está "${charge.status}").`
    );
  }

  const plan = charge.plan as PlanKey;
  const amountPaidCents = charge.amount_cents as number;
  const paidAt = charge.paid_at as string | null;

  // A assinatura é o que dá a vigência — e é ela que será encerrada.
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("id, expires_at")
    .eq("charge_id", chargeId)
    .maybeSingle();

  const expiresAt = (sub?.expires_at as string | undefined) ?? null;

  const daysSincePayment = paidAt
    ? Math.floor((now.getTime() - new Date(paidAt).getTime()) / MS_PER_DAY)
    : null;

  // ── Regra 1: arrependimento em 7 dias ──────────────────────────────────
  // Vem primeiro porque é direito legal e não admite exceção, nem para o
  // mensal, nem "porque já usou". `paidAt` ausente cai aqui por segurança:
  // na dúvida sobre a data, o consumidor não pode perder o prazo.
  if (daysSincePayment == null || daysSincePayment <= CDC_DAYS) {
    return {
      chargeId,
      plan,
      amountPaidCents,
      paidAt,
      daysSincePayment,
      rule: "cdc-7-dias",
      refundCents: amountPaidCents,
      total: true,
      subscriptionId: (sub?.id as string | undefined) ?? null,
      expiresAt,
      explanation:
        "Dentro dos 7 dias do art. 49 do CDC: devolução integral, sem exigir justificativa.",
    };
  }

  // ── Regra 2: mensal fora dos 7 dias ────────────────────────────────────
  if (plan === "mensal") {
    return {
      chargeId,
      plan,
      amountPaidCents,
      paidAt,
      daysSincePayment,
      rule: "sem-reembolso",
      refundCents: 0,
      total: false,
      subscriptionId: (sub?.id as string | undefined) ?? null,
      expiresAt,
      explanation:
        "Plano mensal fora dos 7 dias: a política não prevê devolução proporcional. " +
        "O acesso segue até o fim do período pago e nada é cobrado de novo.",
    };
  }

  // ── Regra 3: anual proporcional ────────────────────────────────────────
  const refundCents = expiresAt
    ? computeProRataRefundCents({
        plan,
        amountPaidCents,
        now,
        expiresAt: new Date(expiresAt),
      })
    : 0;

  return {
    chargeId,
    plan,
    amountPaidCents,
    paidAt,
    daysSincePayment,
    rule: "prorata-anual",
    refundCents,
    total: refundCents === amountPaidCents,
    subscriptionId: (sub?.id as string | undefined) ?? null,
    expiresAt,
    explanation:
      "Plano anual fora dos 7 dias: devolvemos os meses inteiros ainda não usados, " +
      "conforme a Política de Reembolso. O acesso é encerrado na data do estorno.",
  };
}

export interface RefundOutcome {
  chargeId: string;
  refundedCents: number;
  total: boolean;
  rule: RefundRule;
  refundId: string | null;
  accessEndedAt: string;
}

/**
 * Executa o estorno: chama o provedor e **corta o acesso na mesma operação**.
 *
 * A ordem é deliberada — provedor primeiro, banco depois. Se invertêssemos,
 * uma falha na chamada externa deixaria o cliente sem acesso e sem dinheiro,
 * que é o pior dos dois mundos. Na ordem atual, uma falha depois do estorno
 * deixa acesso ativo com dinheiro devolvido: ruim, porém visível (o log grita)
 * e corrigível pelo runbook, além de ser reconciliado na próxima consulta da
 * order, que verá `refunded` e encerrará a assinatura.
 */
export async function refundCharge(params: {
  chargeId: string;
  /** Valor que quem chama espera devolver. Tem de bater com o calculado. */
  expectedCents: number;
  /** Quem pediu — vai para o log, porque estorno é ato administrativo. */
  actor: string;
  now?: Date;
}): Promise<RefundOutcome> {
  if (!supabase) throw new BillingError("NOT_CONFIGURED", "Supabase não configurado.");

  const now = params.now ?? new Date();
  const preview = await previewRefund(params.chargeId, now);

  // Conferência de valor: protege contra o preview ter mudado entre a consulta
  // e a confirmação (o pró-rata cai a cada mês que passa) e contra valor
  // digitado à mão.
  if (params.expectedCents !== preview.refundCents) {
    throw new BillingError(
      "AMOUNT_MISMATCH",
      `Valor confirmado (${params.expectedCents}) não bate com o calculado pela política ` +
        `(${preview.refundCents}). Consulte o preview de novo antes de repetir.`
    );
  }

  if (preview.refundCents <= 0) {
    throw new BillingError(
      "AMOUNT_MISMATCH",
      "A política não prevê devolução neste caso — nada a estornar."
    );
  }

  const { data: charge } = await supabase
    .from("billing_charges")
    .select("provider_order_id")
    .eq("id", params.chargeId)
    .maybeSingle();

  const orderId = charge?.provider_order_id as string | null;
  if (!orderId) {
    throw new BillingError(
      "CHARGE_NOT_FOUND",
      "Cobrança sem id de order no provedor — estorne pelo painel e use o runbook."
    );
  }

  // O id da transação só é necessário no parcial, mas consultar sempre também
  // confirma que a order existe e está no estado que esperamos.
  const snapshot = await getOrder(orderId);

  let result;
  try {
    result = await refundOrder({
      orderId,
      amountCents: preview.total ? undefined : preview.refundCents,
      paymentTransactionId: snapshot.paymentTransactionId,
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), chargeId: params.chargeId, actor: params.actor },
      "[Billing] Provedor recusou o estorno — NADA foi alterado no banco"
    );
    throw new BillingError("PROVIDER_FAILED", "O provedor recusou o estorno. Nada foi alterado.");
  }

  const accessEndedAt = now.toISOString();

  await supabase
    .from("billing_charges")
    .update({ status: "refunded" })
    .eq("id", params.chargeId);

  await expireSubscriptionForCharge(params.chargeId, `estorno solicitado por ${params.actor}`, now);

  logger.info(
    {
      chargeId: params.chargeId,
      actor: params.actor,
      rule: preview.rule,
      refundedCents: preview.refundCents,
      total: preview.total,
      refundId: result.refundId,
    },
    "[Billing] Estorno concluído e acesso encerrado"
  );

  return {
    chargeId: params.chargeId,
    refundedCents: preview.refundCents,
    total: preview.total,
    rule: preview.rule,
    refundId: result.refundId,
    accessEndedAt,
  };
}

/**
 * Encerra a assinatura de uma cobrança: `status = 'refunded'` e vigência em
 * `now`, que é o corte estrito usado no gate (`agora < expires_at`).
 *
 * **Nunca apaga a linha.** Ela é registro de receita e os Termos prometem
 * guardá-la; o que muda é o direito de acesso, não o histórico.
 */
async function expireSubscriptionForCharge(
  chargeId: string,
  motivo: string,
  now: Date = new Date()
): Promise<void> {
  if (!supabase) return;

  const { data, error } = await supabase
    .from("subscriptions")
    .update({ status: "refunded", expires_at: now.toISOString() })
    .eq("charge_id", chargeId)
    .select("id");

  if (error) {
    // Alto e visível: dinheiro devolvido com acesso ainda ativo precisa de gente.
    logger.error(
      { err: error.message, chargeId, motivo },
      "[Billing] FALHA ao encerrar assinatura após estorno — acesso pode seguir ativo"
    );
    return;
  }

  if (!data || data.length === 0) {
    // Cobrança paga sem assinatura correspondente: não é erro se o pagamento
    // nunca chegou a virar assinatura (ex.: estorno antes da confirmação).
    logger.info({ chargeId, motivo }, "[Billing] Estorno sem assinatura correspondente");
    return;
  }

  logger.info({ chargeId, motivo, assinaturas: data.length }, "[Billing] Assinatura encerrada");
}
