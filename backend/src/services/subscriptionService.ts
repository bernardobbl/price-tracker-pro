/**
 * Assinaturas — leitura do direito de acesso pago.
 *
 * Este módulo é **o gate**: é ele que responde "essa pessoa pode usar recurso
 * pago agora?". Não depende de gateway nenhum — lê a tabela `subscriptions` e
 * compara duas datas. Por isso pôde ser construído e testado antes de existir
 * qualquer linha de pagamento (ver docs/runbook-operacao.md §5).
 *
 * A escrita (criar assinatura a partir de um pagamento confirmado) virá com o
 * webhook, na Etapa A. Aqui só se lê.
 *
 * ⚠️ A checagem tem de acontecer AQUI, no backend. O backend fala com o
 * Supabase usando a `service_role`, que **ignora RLS** — então a policy da
 * migração é segunda linha de defesa, não a primeira. E esconder o botão no
 * frontend é experiência do usuário, nunca segurança.
 */

import { supabase } from "../config/supabaseClient";
import { logger } from "../lib/logger";
import { isWithinPeriod, type PlanKey } from "../lib/subscriptionPeriod";

export interface ActiveSubscription {
  plan: PlanKey;
  startsAt: Date;
  expiresAt: Date;
}

export interface EntitlementStatus {
  /** Tem acesso pago valendo neste instante? */
  active: boolean;
  plan: PlanKey | null;
  expiresAt: Date | null;
  /** Dias inteiros até vencer. `null` quando não há assinatura ativa. */
  daysLeft: number | null;
}

const INACTIVE: EntitlementStatus = {
  active: false,
  plan: null,
  expiresAt: null,
  daysLeft: null,
};

/**
 * Busca a assinatura ativa de maior vigência do usuário.
 *
 * Filtra por `expires_at > now()` no próprio banco (barato, usa índice) e
 * revalida em memória com `isWithinPeriod`, porque o relógio do Postgres e o
 * do Node podem divergir por milissegundos — e o corte é estrito.
 */
export async function getActiveSubscription(
  userId: string,
  now: Date = new Date()
): Promise<ActiveSubscription | null> {
  if (!supabase) {
    // Sem Supabase (dev/demo local) ninguém é assinante. Falha fechado:
    // liberar acesso pago por causa de env faltando seria o pior default.
    return null;
  }

  const { data, error } = await supabase
    .from("subscriptions")
    .select("plan, starts_at, expires_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .gt("expires_at", now.toISOString())
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error({ err: error.message }, "[Subscription] Falha ao consultar assinatura");
    // Falha fechado de novo: erro de banco não pode virar acesso liberado.
    return null;
  }

  if (!data) return null;

  const expiresAt = new Date(data.expires_at as string);
  if (!isWithinPeriod(now, expiresAt)) return null;

  return {
    plan: data.plan as PlanKey,
    startsAt: new Date(data.starts_at as string),
    expiresAt,
  };
}

/** Resposta pronta para a API e para decisões de gate. */
export async function getEntitlement(
  userId: string,
  now: Date = new Date()
): Promise<EntitlementStatus> {
  const sub = await getActiveSubscription(userId, now);
  if (!sub) return INACTIVE;

  return {
    active: true,
    plan: sub.plan,
    expiresAt: sub.expiresAt,
    daysLeft: Math.floor((sub.expiresAt.getTime() - now.getTime()) / 86_400_000),
  };
}

/** Atalho booleano para os pontos de gate. */
export async function hasActiveSubscription(
  userId: string,
  now: Date = new Date()
): Promise<boolean> {
  return (await getActiveSubscription(userId, now)) !== null;
}
