/**
 * Rotas autenticadas do domínio combustível: favoritos (`tracked_series`) e
 * alertas por série. Substituíram as antigas rotas de produto/alerta de livros
 * (removidas na Fase 6.8 · J4).
 *
 *   GET/POST    /api/fuel/tracked            → listar / criar favorito
 *   DELETE      /api/fuel/tracked/:id        → excluir favorito
 *   GET/POST    /api/fuel/alerts             → listar / criar-atualizar alerta
 *   DELETE      /api/fuel/alerts/:id         → excluir alerta
 */

import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware";
import { validate } from "../middleware/validate";
import { sendError } from "../lib/httpError";
import {
  createFuelAlertSchema,
  createTrackedSeriesSchema,
  uuidParamSchema,
} from "../schemas/requestSchemas";
import {
  createTrackedSeries,
  deleteTrackedSeries,
  getOwnedTrackedSeries,
  listTrackedSeries,
} from "../services/trackedSeriesService";
import {
  createOrUpdateFuelAlert,
  deleteFuelAlert,
  evaluateFuelAlertImmediately,
  listFuelAlerts,
  countFuelAlerts,
} from "../services/fuelAlertService";
import { getEntitlement, hasActiveSubscription } from "../services/subscriptionService";
import { decideAlertQuota } from "../lib/alertQuota";

const router = Router();

// ── Assinatura ──────────────────────────────────────────────────────────────
/**
 * Situação do acesso pago do usuário logado.
 *
 * Serve para a interface decidir o que mostrar. **Não é o gate** — esconder
 * botão é experiência do usuário, não segurança. Quem barra de verdade é a
 * checagem no POST /alerts abaixo.
 */
router.get(
  "/entitlement",
  requireAuth,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return sendError(res, 401, "UNAUTHENTICATED", "Usuário não autenticado.");

    const status = await getEntitlement(userId);
    return res.json({
      active: status.active,
      plan: status.plan,
      expiresAt: status.expiresAt ? status.expiresAt.toISOString() : null,
      daysLeft: status.daysLeft,
    });
  })
);

// ── Favoritos (tracked_series) ──────────────────────────────────────────────
router.get(
  "/tracked",
  requireAuth,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    res.json(await listTrackedSeries(req.user?.id));
  })
);

router.post(
  "/tracked",
  requireAuth,
  validate(createTrackedSeriesSchema),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return sendError(res, 401, "UNAUTHENTICATED", "Usuário não autenticado.");
    const { product, state, municipality, brand, label } = req.body;
    const series = await createTrackedSeries({ userId, product, state, municipality, brand, label });
    return res.status(201).json(series);
  })
);

router.delete(
  "/tracked/:id",
  requireAuth,
  validate(uuidParamSchema, "params"),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    await deleteTrackedSeries(req.params.id, req.user?.id);
    res.status(204).send();
  })
);

// ── Alertas por série ───────────────────────────────────────────────────────
router.get(
  "/alerts",
  requireAuth,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    res.json(await listFuelAlerts(req.user?.id));
  })
);

router.post(
  "/alerts",
  requireAuth,
  validate(createFuelAlertSchema),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return sendError(res, 401, "UNAUTHENTICATED", "Usuário não autenticado.");

    const { seriesId, thresholdPrice, currency, channel, enabled } = req.body;

    // Posse da série: o backend usa a service_role (bypassa RLS), então o filtro
    // por dono precisa ser explícito aqui — sem isso, um `series_id` de outra
    // pessoa criaria um alerta válido e devolveria os dados dela no join.
    // 404 (e não 403) para não revelar se o id existe.
    const owned = await getOwnedTrackedSeries(seriesId, userId);
    if (!owned) return sendError(res, 404, "SERIES_NOT_FOUND", "Série favoritada não encontrada.");

    // ── Gate de assinatura ────────────────────────────────────────────────
    // O backend usa a service_role, que ignora RLS: a checagem TEM de estar
    // aqui. Desde 05/ago/2026 ela barra de verdade — `FREE_ALERT_LIMIT` é 1.
    const existing = await listFuelAlerts(userId);
    const alreadyHasThisSeries = existing.some(
      (a) => (a as { series_id?: string }).series_id === seriesId
    );

    if (!alreadyHasThisSeries) {
      // Só conta cota quando é alerta NOVO: o upsert por (user_id, series_id,
      // channel) faz atualização não criar linha, e atualizar não pode custar cota.
      //
      // A contagem vem do `countFuelAlerts`, e não do `existing.length`, por um
      // motivo específico: aquele devolve `null` quando o banco não responde,
      // enquanto uma lista vazia é indistinguível de "não tem alerta". Com cota
      // finita, confundir os dois libera todo mundo justamente quando o sistema
      // está menos confiável. Diante do "não sei", recusamos.
      const currentCount = await countFuelAlerts(userId);
      if (currentCount == null) {
        return sendError(
          res,
          503,
          "QUOTA_CHECK_FAILED",
          "Não conseguimos verificar seu plano agora. Tente de novo em instantes."
        );
      }

      const quota = decideAlertQuota({
        hasActiveSubscription: await hasActiveSubscription(userId),
        currentCount,
      });
      if (!quota.allowed) {
        return sendError(res, 402, "ALERT_QUOTA_EXCEEDED", quota.reason);
      }
    }

    const alert = await createOrUpdateFuelAlert({
      userId,
      seriesId,
      thresholdPrice,
      currency,
      channel: channel ?? "email",
      enabled,
    });

    // Avaliação imediata: se já está no/abaixo do alvo, notifica na hora.
    const series = (alert as { tracked_series?: unknown })?.tracked_series;
    if (alert && series && typeof series === "object") {
      const s = series as {
        product: string; state: string; municipality: string; brand: string | null; label: string;
      };
      await evaluateFuelAlertImmediately({
        alertId: (alert as { id: string }).id,
        userId,
        series: s,
        thresholdPrice,
        currency: currency ?? "R$",
      });
    }

    return res.status(201).json(alert);
  })
);

router.delete(
  "/alerts/:id",
  requireAuth,
  validate(uuidParamSchema, "params"),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    await deleteFuelAlert(req.params.id, req.user?.id);
    res.status(204).send();
  })
);

export default router;
