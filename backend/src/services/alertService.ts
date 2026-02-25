import { supabase } from "../config/supabaseClient";
import { sendPriceAlertEmail } from "./emailService";

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
    console.error("[Alerts] Erro ao criar/atualizar alerta:", error.message);
    throw new Error("Erro ao salvar alerta de preço");
  }

  return data;
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
    console.error("[Alerts] Erro ao listar alertas:", error.message);
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
    console.error("[Alerts] Erro ao buscar alertas para avaliação:", error.message);
    return;
  }

  if (!alerts || alerts.length === 0) return;

  for (const alert of alerts) {
    const threshold = Number(alert.threshold_price);
    const alreadyTriggered = alert.triggered as boolean;

    if (Number.isNaN(threshold)) {
      // ignora alertas inválidos
      // eslint-disable-next-line no-continue
      continue;
    }

    // Regra anti-spam simples
    if (currentPrice <= threshold && !alreadyTriggered) {
      // dispara email se houver email disponível
      const { data: userData, error: userError } = await supabase
        .auth
        .admin
        .getUserById(alert.user_id);

      if (userError) {
        console.error("[Alerts] Erro ao buscar usuário para envio de email:", userError.message);
      } else if (userData && userData.user?.email) {
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
        } catch (err) {
          console.error("[Alerts] Falha ao enviar email de alerta:", err);
        }
      }

      const { error: updateError } = await supabase
        .from("alerts")
        .update({
          triggered: true,
          last_notified_at: new Date().toISOString()
        })
        .eq("id", alert.id);

      if (updateError) {
        console.error("[Alerts] Erro ao marcar alerta como disparado:", updateError.message);
      }
    }

    if (currentPrice > threshold && alreadyTriggered) {
      const { error: resetError } = await supabase
        .from("alerts")
        .update({
          triggered: false
        })
        .eq("id", alert.id);

      if (resetError) {
        console.error("[Alerts] Erro ao resetar alerta:", resetError.message);
      }
    }
  }
}

