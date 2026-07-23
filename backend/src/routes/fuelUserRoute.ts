/**
 * Rotas autenticadas do domínio combustível: favoritos (`tracked_series`) e
 * alertas por série. Substituem, no novo domínio, as rotas de produto/alerta de
 * livros (que serão removidas no J4).
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
  listTrackedSeries,
} from "../services/trackedSeriesService";
import {
  createOrUpdateFuelAlert,
  deleteFuelAlert,
  evaluateFuelAlertImmediately,
  listFuelAlerts,
} from "../services/fuelAlertService";

const router = Router();

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
