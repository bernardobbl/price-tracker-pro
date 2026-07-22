import { supabase } from "../config/supabaseClient";
import { sendPriceAlertEmail } from "./emailService";
import { logger } from "../lib/logger";

export type AlertAction = "notify" | "reset" | "none";

/**
 * Decide o que fazer com um alerta dado o preço atual (lógica pura, testável).
 * - "notify": preço atingiu o alvo e o alerta ainda não foi disparado
 * - "reset":  preço voltou a subir acima do alvo → rearmar o alerta
 * - "none":   nada a fazer (ou threshold inválido)
 */
export function decideAlertAction(
  currentPrice: number,
  threshold: number,
  alreadyTriggered: boolean
): AlertAction {
  if (Number.isNaN(threshold)) return "none";
  if (currentPrice <= threshold && !alreadyTriggered) return "notify";
  if (currentPrice > threshold && alreadyTriggered) return "reset";
  return "none";
}

export interface CreateOrUpdateAlertInput {
  userId: string;
  productId: string;
  thresholdPrice: number;
  currency?: string;
  channel?: "email";
  enabled?: boolean;
}

export async function createOrUpdateAlert(input: CreateOrUpdateAlertInput) {
  if (!supabase) {
    throw new Error("Alertas requerem Supabase configurado.");
  }

  const currency = input.currency ?? "R$";
  const channel = input.channel ?? "email";

  const { data, error } = await supabase
    .from("alerts")
    .upsert(
      {
        user_id: input.userId,
        // usamos o slug do produto como identificador
        tracked_product_id: input.productId,
        threshold_price: input.thresholdPrice,
        currency,
        channel,
        enabled: input.enabled ?? true
      },
      {
        onConflict: "user_id,tracked_product_id,channel"
      }
    )
    .select("*")
    .maybeSingle();

  if (error) {
    logger.error({ err: error.message }, "[Alerts] Erro ao criar/atualizar alerta");
    throw new Error("Erro ao salvar alerta de preço");
  }

  return data;
}

// ── Envio de email (trilha única + cache de email por usuário) ──────────────

// Evita N chamadas admin.getUserById numa mesma rodada (ex.: job diário com
// vários alertas do mesmo usuário). Emails mudam raramente; cache simples basta.
const emailCache = new Map<string, string | null>();

/** Limpa o cache de emails (usado em testes). */
export function __clearEmailCache() {
  emailCache.clear();
}

async function getUserEmail(userId: string): Promise<string | null> {
  if (emailCache.has(userId)) return emailCache.get(userId) ?? null;
  if (!supabase) return null;

  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) {
    logger.error({ err: error.message }, "[Alerts] Erro ao buscar usuário para envio de email");
    return null;
  }

  const email = data?.user?.email ?? null;
  emailCache.set(userId, email);
  return email;
}

interface AlertEmailInput {
  alertId: string;
  userId: string;
  productId: string;
  productName: string;
  thresholdPrice: number;
  currentPrice: number;
  currency: string;
  url: string;
}

/**
 * Trilha única de notificação: envia o email do alerta e marca como disparado.
 * Usada tanto na avaliação imediata quanto na pós-scraping. Retorna true se notificou.
 */
async function sendAlertEmailAndMark(input: AlertEmailInput): Promise<boolean> {
  if (!supabase) return false;

  const email = await getUserEmail(input.userId);
  if (!email) {
    logger.warn({ alertId: input.alertId }, "[Alerts] Usuário sem email cadastrado");
    return false;
  }

  try {
    await sendPriceAlertEmail({
      to: email,
      productId: input.productId,
      productName: input.productName,
      thresholdPrice: input.thresholdPrice,
      currentPrice: input.currentPrice,
      currency: input.currency,
      url: input.url,
    });

    const { error: updateError } = await supabase
      .from("alerts")
      .update({ triggered: true, last_notified_at: new Date().toISOString() })
      .eq("id", input.alertId);

    if (updateError) {
      logger.error({ err: updateError.message }, "[Alerts] Erro ao marcar alerta como disparado");
    }
    return true;
  } catch (err) {
    // Não marca triggered → permite nova tentativa na próxima verificação.
    logger.error({ err }, "[Alerts] Falha ao enviar email de alerta");
    return false;
  }
}

/**
 * Avalia imediatamente se o preço atual já atinge o threshold; se sim, notifica.
 */
export async function evaluateAlertImmediately(params: {
  alertId: string;
  userId: string;
  productId: string;
  thresholdPrice: number;
  currentPrice: number;
  currency: string;
  productName: string;
  productUrl: string;
}): Promise<boolean> {
  if (!supabase) return false;

  const { alertId, userId, productId, thresholdPrice, currentPrice, currency, productName, productUrl } = params;

  if (decideAlertAction(currentPrice, thresholdPrice, false) !== "notify") return false;

  return sendAlertEmailAndMark({
    alertId,
    userId,
    productId,
    productName,
    thresholdPrice,
    currentPrice,
    currency,
    url: productUrl,
  });
}

export async function deleteAlert(alertId: string, userId: string): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase
    .from("alerts")
    .delete()
    .eq("id", alertId)
    .eq("user_id", userId);

  if (error) {
    logger.error({ err: error.message }, "[Alerts] Erro ao excluir alerta");
    throw new Error("Erro ao excluir alerta");
  }
}

export async function listAlertsByUser(userId: string) {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("alerts")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    logger.error({ err: error.message }, "[Alerts] Erro ao listar alertas");
    return [];
  }

  return data ?? [];
}

interface EvaluateAlertsParams {
  productId: string;
  currentPrice: number;
  fullPrice: number;
  currency: string;
  title: string;
  url: string;
}

export async function evaluateAlertsForPrice(params: EvaluateAlertsParams) {
  if (!supabase) return;

  const { productId, currentPrice, currency, title, url } = params;

  const { data: alerts, error } = await supabase
    .from("alerts")
    .select("*")
    .eq("tracked_product_id", productId)
    .eq("enabled", true);

  if (error) {
    logger.error({ err: error.message }, "[Alerts] Erro ao buscar alertas para avaliação");
    return;
  }

  if (!alerts || alerts.length === 0) return;

  for (const alert of alerts) {
    const threshold = Number(alert.threshold_price);
    const action = decideAlertAction(currentPrice, threshold, alert.triggered as boolean);

    // Regra anti-spam: só notifica uma vez até o preço voltar a subir.
    if (action === "notify") {
      await sendAlertEmailAndMark({
        alertId: alert.id,
        userId: alert.user_id,
        productId,
        productName: title,
        thresholdPrice: threshold,
        currentPrice,
        currency,
        url,
      });
    } else if (action === "reset") {
      const { error: resetError } = await supabase
        .from("alerts")
        .update({ triggered: false })
        .eq("id", alert.id);

      if (resetError) {
        logger.error({ err: resetError.message }, "[Alerts] Erro ao resetar alerta");
      }
    }
  }
}

