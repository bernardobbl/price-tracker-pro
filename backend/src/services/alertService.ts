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

/**
 * Avalia imediatamente se o preço atual já atinge o threshold.
 * Se sim, envia o email na hora e marca o alerta como disparado.
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

  if (currentPrice > thresholdPrice) return false;

  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
  if (userError) {
    logger.error({ err: userError.message }, "[Alerts] Erro ao buscar usuário para email imediato");
    return false;
  }
  if (!userData?.user?.email) {
    logger.warn("[Alerts] Usuário sem email cadastrado");
    return false;
  }

  try {
    await sendPriceAlertEmail({
      to: userData.user.email,
      productId,
      productName,
      thresholdPrice,
      currentPrice,
      currency,
      url: productUrl
    });
    await supabase
      .from("alerts")
      .update({ triggered: true, last_notified_at: new Date().toISOString() })
      .eq("id", alertId);
    logger.info("[Alerts] Email enviado imediatamente (threshold já atingido)");
    return true;
  } catch (err) {
    logger.error({ err }, "[Alerts] Falha ao enviar email de alerta imediato");
    return false;
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
    const alreadyTriggered = alert.triggered as boolean;
    const action = decideAlertAction(currentPrice, threshold, alreadyTriggered);

    // Regra anti-spam: só notifica uma vez até o preço voltar a subir.
    if (action === "notify") {
      const { data: userData, error: userError } = await supabase.auth.admin.getUserById(
        alert.user_id
      );

      if (userError) {
        logger.error({ err: userError.message }, "[Alerts] Erro ao buscar usuário para envio de email");
        continue;
      }

      if (!userData?.user?.email) {
        logger.warn({ alertId: alert.id }, "[Alerts] Usuário sem email cadastrado");
        continue;
      }

      try {
        await sendPriceAlertEmail({
          to: userData.user.email,
          productId,
          productName: title,
          thresholdPrice: threshold,
          currentPrice,
          currency,
          url
        });

        const { error: updateError } = await supabase
          .from("alerts")
          .update({
            triggered: true,
            last_notified_at: new Date().toISOString()
          })
          .eq("id", alert.id);

        if (updateError) {
          logger.error({ err: updateError.message }, "[Alerts] Erro ao marcar alerta como disparado");
        }
      } catch (err) {
        logger.error({ err }, "[Alerts] Falha ao enviar email de alerta");
        // Não marca como triggered para permitir nova tentativa na próxima verificação
      }
    }

    if (action === "reset") {
      const { error: resetError } = await supabase
        .from("alerts")
        .update({
          triggered: false
        })
        .eq("id", alert.id);

      if (resetError) {
        logger.error({ err: resetError.message }, "[Alerts] Erro ao resetar alerta");
      }
    }
  }
}

