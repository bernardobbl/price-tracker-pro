/**
 * Alertas reais do domínio combustível (I4).
 *
 * Um alerta aponta para um `tracked_series` (produto + UF + município [+ bandeira])
 * e dispara quando o **preço médio mais recente do município** cai no/abaixo do
 * threshold. Diferente do domínio livros (preço estático de sandbox), aqui o
 * preço muda de verdade a cada levantamento da ANP — então o alerta dispara de fato.
 *
 * Reusa a lógica pura de decisão (`decideAlertAction`), o cache de email
 * (`userEmailService`) e o envio (`emailService`) — módulos neutros de domínio.
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

/**
 * Quantos alertas o usuário tem — ou `null` quando **não deu para saber**.
 *
 * ## Por que não reaproveitar o `listFuelAlerts`
 *
 * Aquele devolve `[]` tanto para "não tem alerta nenhum" quanto para "o banco
 * não respondeu". Enquanto a cota do plano gratuito era `Infinity` isso era
 * inofensivo. No instante em que o limite virou finito, passou a ser **falha
 * aberta**: banco fora → lista vazia → contagem 0 → cota liberada para todo
 * mundo, exatamente quando o sistema está menos confiável.
 *
 * O aviso estava escrito no `alertQuota.ts` desde 04/ago/2026, prevendo este
 * dia. Esta função existe para que quem decide a cota consiga distinguir zero
 * de "não sei" — e, diante do "não sei", recusar.
 */
export async function countFuelAlerts(userId?: string | null): Promise<number | null> {
  if (!supabase || !userId) return null;

  const { count, error } = await supabase
    .from("alerts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (error) {
    logger.error({ err: error.message }, "[fuelAlerts] Erro ao contar alertas para a cota");
    return null;
  }

  return count ?? null;
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
  /** Série completa: o email usa o rótulo no texto e produto/UF/município no link. */
  series: SeriesInfo;
  thresholdPrice: number;
  currentPrice: number;
  currency: string;
  collectedAt?: string | null;
}): Promise<boolean> {
  if (!supabase) return false;

  const email = await getUserEmail(params.userId);
  if (!email) {
    logger.warn({ alertId: params.alertId }, "[fuelAlerts] Usuário sem email cadastrado");
    return false;
  }

  try {
    const enviado = await sendPriceAlertEmail({
      to: email,
      series: params.series,
      thresholdPrice: params.thresholdPrice,
      currentPrice: params.currentPrice,
      currency: params.currency,
      collectedAt: params.collectedAt,
    });

    // Sem envio, não marca. `triggered: true` é uma porta de mão única: o alerta
    // só volta a disparar se o preço subir acima do alvo e a avaliação seguinte
    // o resetar. Marcar sem ter enviado queima o alerta em silêncio — foi o que
    // aconteceu enquanto o GitHub Actions rodou sem os secrets de SMTP.
    if (!enviado) {
      logger.warn(
        { alertId: params.alertId },
        "[fuelAlerts] Email não enviado (SMTP indisponível) — alerta NÃO marcado, tentará de novo"
      );
      return false;
    }

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
    series: params.series,
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
        series,
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
