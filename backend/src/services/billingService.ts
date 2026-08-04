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
 */

import { supabase } from "../config/supabaseClient";
import { logger } from "../lib/logger";
import {
  computeExpiresAt,
  PLAN_PRICE_CENTS,
  type PlanKey,
} from "../lib/subscriptionPeriod";
import { createPixOrder, getOrder, type NormalizedStatus } from "./mercadoPagoClient";
import { getActiveSubscription } from "./subscriptionService";

export class BillingError extends Error {
  code:
    | "NOT_CONFIGURED"
    | "CHARGE_NOT_FOUND"
    | "USER_REQUIRED"
    | "ALREADY_PROCESSED"
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

/** Status da cobrança, do nosso banco — é o que o polling da página consulta. */
export async function getChargeStatus(
  chargeId: string,
  userId: string
): Promise<ChargeStatus | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("billing_charges")
    .select("id, status, plan, amount_cents")
    .eq("id", chargeId)
    .eq("user_id", userId) // o backend ignora RLS: o filtro por dono é explícito
    .maybeSingle();

  if (error || !data) return null;

  return {
    chargeId: data.id as string,
    status: data.status as NormalizedStatus,
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
    return { created: false, status: snapshot.status, chargeId: id };
  }

  // 5. Já processada? O webhook repete — esta é a 1ª camada de idempotência.
  if (charge.status === "paid") {
    return { created: false, status: "paid", chargeId: id };
  }

  const now = new Date();

  // 6. Vigência somando o saldo restante, se houver assinatura ativa.
  const atual = await getActiveSubscription(userId, now);
  const expiresAt = computeExpiresAt({
    plan,
    now,
    currentExpiresAt: atual?.expiresAt ?? null,
  });

  // 7. Cria a assinatura. A 2ª camada de idempotência é o índice único em
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
