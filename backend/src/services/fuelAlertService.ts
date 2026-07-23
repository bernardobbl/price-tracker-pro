/**
 * Alertas reais do domínio combustível (I4).
 *
 * Um alerta aponta para um `tracked_series` (produto + UF + município [+ bandeira])
 * e dispara quando o **preço médio mais recente do município** cai no/abaixo do
 * threshold. Diferente do domínio livros (preço estático de sandbox), aqui o
 * preço muda de verdade a cada levantamento da ANP — então o alerta dispara de fato.
 *
 * Reusa a lógica pura de decisão (`decideAlertAction`), o cache de email
 * (`userEmailService`) e o envio (`emailService`), sem acoplar ao serviço de livros.
 */

import { supabase } from "../config/supabaseClient";
import { logger } from "../lib/logger";
import { decideAlertAction } from "../lib/alertDecision";
import { getUserEmail } from "./userEmailService";
import { sendPriceAlertEmail } from "./emailService";
import { getSnapshot } from "./fuelQueryService";

export interface CreateFuelAlertInput {
  userId: string;
  seriesId: string;
  thresholdPrice: number;
  currency?: string;
  channel?: "email";
  enabled?: boolean;
}

/** Cria/atualiza um alerta por série (upsert em user_id+series_id+channel). */
export async function createOrUpdateFuelAlert(input: CreateFuelAlertInput) {
  if (!supabase) throw new Error("Alertas requerem Supabase configurado.");

  const { data, error } = await supabase
    .from("alerts")
    .upsert(
      {
        user_id: input.userId,
        series_id: input.seriesId,
        threshold_price: input.thresholdPrice,
        currency: input.currency ?? "R$",
        channel: input.channel ?? "email",
        enabled: input.enabled ?? true,
      },
      { onConflict: "user_id,series_id,channel" }
    )
    .select("*, tracked_series(product, state, municipality, brand, label)")
    .maybeSingle();

  if (error) {
    logger.error({ err: error.message }, "[fuelAlerts] Erro ao criar/atualizar alerta");
    throw new Error("Erro ao salvar alerta de combustível");
  }
  return data;
}

/** Lista os alertas do usuário com os dados da série (para exibir no front). */
export async function listFuelAlerts(userId?: string | null) {
  if (!supabase || !userId) return [];
  const { data, error } = await supabase
    .from("alerts")
    .select("*, tracked_series(product, state, municipality, brand, label)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    logger.error({ err: error.message }, "[fuelAlerts] Erro ao listar alertas");
    return [];
  }
  return data ?? [];
}

export async function deleteFuelAlert(alertId: string, userId?: string | null): Promise<void> {
  if (!supabase || !userId) return;
  const { error } = await supabase
    .from("alerts")
    .delete()
    .eq("id", alertId)
    .eq("user_id", userId);

  if (error) {
    logger.error({ err: error.message }, "[fuelAlerts] Erro ao excluir alerta");
    throw new Error("Erro ao excluir alerta");
  }
}

interface SeriesInfo {
  product: string;
  state: string;
  municipality: string;
  brand: string | null;
  label: string;
}

/** Preço "atual" de uma série = média do levantamento mais recente do município. */
async function currentSeriesAvg(series: SeriesInfo): Promise<number | null> {
  const snap = await getSnapshot(series.product, series.state, series.municipality, series.brand);
  return snap.avgPrice;
}

/** Envia o email do alerta e marca como disparado. Retorna true se notificou. */
async function notifyAndMark(params: {
  alertId: string;
  userId: string;
  seriesLabel: string;
  thresholdPrice: number;
  currentPrice: number;
  currency: string;
}): Promise<boolean> {
  if (!supabase) return false;

  const email = await getUserEmail(params.userId);
  if (!email) {
    logger.warn({ alertId: params.alertId }, "[fuelAlerts] Usuário sem email cadastrado");
    return false;
  }

  try {
    await sendPriceAlertEmail({
      to: email,
      productId: params.seriesLabel,
      productName: params.seriesLabel,
      thresholdPrice: params.thresholdPrice,
      currentPrice: params.currentPrice,
      currency: params.currency,
      url: "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/serie-historica-de-precos-de-combustiveis",
    });

    const { error } = await supabase
      .from("alerts")
      .update({ triggered: true, last_notified_at: new Date().toISOString() })
      .eq("id", params.alertId);
    if (error) logger.error({ err: error.message }, "[fuelAlerts] Erro ao marcar alerta disparado");
    return true;
  } catch (err) {
    logger.error({ err }, "[fuelAlerts] Falha ao enviar email de alerta");
    return false; // não marca → tenta de novo na próxima avaliação
  }
}

/**
 * Avaliação imediata ao criar um alerta: se o preço médio atual já está no/abaixo
 * do alvo, notifica na hora (bom feedback de UX).
 */
export async function evaluateFuelAlertImmediately(params: {
  alertId: string;
  userId: string;
  series: SeriesInfo;
  thresholdPrice: number;
  currency: string;
}): Promise<boolean> {
  if (!supabase) return false;
  const avg = await currentSeriesAvg(params.series);
  if (avg == null) return false;
  if (decideAlertAction(avg, params.thresholdPrice, false) !== "notify") return false;

  return notifyAndMark({
    alertId: params.alertId,
    userId: params.userId,
    seriesLabel: params.series.label,
    thresholdPrice: params.thresholdPrice,
    currentPrice: avg,
    currency: params.currency,
  });
}

interface AlertWithSeries {
  id: string;
  user_id: string;
  threshold_price: number | string;
  currency: string | null;
  triggered: boolean;
  tracked_series: SeriesInfo | null;
}

/**
 * Avalia TODOS os alertas ativos contra o levantamento mais recente. Chamado pelo
 * job semanal após uma ingestão bem-sucedida. Agrupa por série para calcular a
 * média do município uma vez só (evita N consultas repetidas).
 */
export async function evaluateAllFuelAlerts(): Promise<{ evaluated: number; notified: number }> {
  if (!supabase) return { evaluated: 0, notified: 0 };

  const { data, error } = await supabase
    .from("alerts")
    .select("id, user_id, threshold_price, currency, triggered, tracked_series(product, state, municipality, brand, label)")
    .eq("enabled", true);

  if (error) {
    logger.error({ err: error.message }, "[fuelAlerts] Erro ao carregar alertas para avaliação");
    return { evaluated: 0, notified: 0 };
  }

  const alerts = (data ?? []) as unknown as AlertWithSeries[];
  // Cache de média por série (chave: product|state|municipality|brand).
  const avgCache = new Map<string, number | null>();
  let notified = 0;

  for (const alert of alerts) {
    const series = alert.tracked_series;
    if (!series) continue;

    const key = `${series.product}|${series.state}|${series.municipality}|${series.brand ?? ""}`;
    let avg = avgCache.get(key);
    if (avg === undefined) {
      avg = await currentSeriesAvg(series);
      avgCache.set(key, avg);
    }
    if (avg == null) continue;

    const threshold = Number(alert.threshold_price);
    const action = decideAlertAction(avg, threshold, alert.triggered);

    if (action === "notify") {
      const ok = await notifyAndMark({
        alertId: alert.id,
        userId: alert.user_id,
        seriesLabel: series.label,
        thresholdPrice: threshold,
        currentPrice: avg,
        currency: alert.currency ?? "R$",
      });
      if (ok) notified++;
    } else if (action === "reset") {
      const { error: resetError } = await supabase
        .from("alerts")
        .update({ triggered: false })
        .eq("id", alert.id);
      if (resetError) logger.error({ err: resetError.message }, "[fuelAlerts] Erro ao resetar alerta");
    }
  }

  logger.info({ evaluated: alerts.length, notified }, "[fuelAlerts] Avaliação de alertas concluída");
  return { evaluated: alerts.length, notified };
}
