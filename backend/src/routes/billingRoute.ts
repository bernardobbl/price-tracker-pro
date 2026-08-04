/**
 * Rotas de cobrança e assinatura.
 *
 *   POST /api/billing/checkout        → cria a cobrança e devolve o QR Pix (autenticado)
 *   GET  /api/billing/charge/:id      → status da cobrança, para o polling da página
 *   POST /api/billing/webhook         → notificação do Mercado Pago (público, por natureza)
 *
 * O webhook é o único endpoint público daqui, e isso é inevitável: quem chama é
 * o provedor, que não tem como se autenticar com um token nosso. A proteção não
 * vem de bloquear a porta e sim de **não confiar no que entra por ela** — o
 * corpo da notificação é usado apenas para descobrir *qual* order consultar, e
 * a verdade vem de um GET autenticado na API do Mercado Pago.
 */

import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware";
import { validate } from "../middleware/validate";
import { sendError } from "../lib/httpError";
import { logger } from "../lib/logger";
import { createCheckoutSchema, uuidParamSchema } from "../schemas/requestSchemas";
import { isBillingEnabled } from "../config/mercadoPago";
import {
  BillingError,
  confirmPaymentByOrderId,
  createCharge,
  getChargeStatus,
} from "../services/billingService";

const router = Router();

// ── Criar cobrança ──────────────────────────────────────────────────────────
router.post(
  "/checkout",
  requireAuth,
  validate(createCheckoutSchema),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    if (!isBillingEnabled()) {
      return sendError(
        res,
        503,
        "BILLING_DISABLED",
        "Pagamento não está disponível no momento."
      );
    }

    const userId = req.user?.id;
    const email = req.user?.email;
    if (!userId) return sendError(res, 401, "UNAUTHENTICATED", "Usuário não autenticado.");
    if (!email) {
      // Sem email não há para onde mandar a confirmação nem como identificar o
      // pagador no provedor.
      return sendError(res, 400, "EMAIL_REQUIRED", "Sua conta precisa de um email válido.");
    }

    const { plan, legalVersion } = req.body;

    try {
      const charge = await createCharge({ userId, plan, email, legalVersion });
      return res.status(201).json(charge);
    } catch (err) {
      if (err instanceof BillingError) {
        const status = err.code === "PROVIDER_FAILED" ? 502 : 500;
        return sendError(res, status, err.code, err.message);
      }
      throw err;
    }
  })
);

// ── Status da cobrança (polling da página) ──────────────────────────────────
router.get(
  "/charge/:id",
  requireAuth,
  validate(uuidParamSchema, "params"),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return sendError(res, 401, "UNAUTHENTICATED", "Usuário não autenticado.");

    const status = await getChargeStatus(req.params.id, userId);
    // 404 (e não 403) quando não é do usuário: não revelamos se o id existe.
    if (!status) return sendError(res, 404, "CHARGE_NOT_FOUND", "Cobrança não encontrada.");

    return res.json(status);
  })
);

// ── Webhook do Mercado Pago ─────────────────────────────────────────────────
/**
 * Extrai o id da order da notificação.
 *
 * O formato varia conforme o tópico e já mudou de versão para versão, então
 * tentamos os caminhos conhecidos em vez de assumir um só. Se nenhum servir,
 * respondemos 200 mesmo assim — ver o comentário do handler.
 */
function extractOrderId(body: unknown, query: unknown): string | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const q = (query ?? {}) as Record<string, unknown>;

  const data = b.data as Record<string, unknown> | undefined;
  const resource = typeof b.resource === "string" ? b.resource : null;

  const candidates = [
    data?.id,
    b.id,
    q["data.id"],
    q.id,
    // `resource` às vezes vem como URL: .../v1/orders/{id}
    resource ? resource.split("/").filter(Boolean).pop() : null,
  ];

  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
    if (typeof c === "number") return String(c);
  }
  return null;
}

router.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    // Responder 200 rápido é regra de webhook: qualquer coisa diferente disso
    // faz o provedor reenviar em backoff, e um erro nosso viraria uma enxurrada
    // de retentativas. Só devolvemos erro quando a culpa é claramente dele.
    const orderId = extractOrderId(req.body, req.query);

    if (!orderId) {
      logger.warn({ body: req.body }, "[Billing] Webhook sem id identificável — ignorado");
      return res.status(200).json({ received: true, ignored: true });
    }

    if (!isBillingEnabled()) {
      logger.warn("[Billing] Webhook recebido com cobrança desligada — ignorado");
      return res.status(200).json({ received: true, ignored: true });
    }

    try {
      const result = await confirmPaymentByOrderId(orderId);
      logger.info(
        { orderId, status: result.status, created: result.created },
        "[Billing] Webhook processado"
      );
      return res.status(200).json({ received: true, ...result });
    } catch (err) {
      if (err instanceof BillingError && err.code === "CHARGE_NOT_FOUND") {
        // Pode ser notificação de uma order que não é nossa (ou de outro
        // ambiente). Não é erro nosso: 200 para o provedor parar de reenviar.
        return res.status(200).json({ received: true, ignored: true });
      }

      // Aqui a falha é nossa (banco fora, provedor instável). 500 faz o
      // Mercado Pago reenviar — que é exatamente o que queremos, porque o
      // processamento é idempotente e um pagamento não pode se perder.
      logger.error(
        { err: err instanceof Error ? err.message : String(err), orderId },
        "[Billing] Falha ao processar webhook — pedindo retentativa"
      );
      return sendError(res, 500, "WEBHOOK_FAILED", "Falha ao processar notificação.");
    }
  })
);

export default router;
