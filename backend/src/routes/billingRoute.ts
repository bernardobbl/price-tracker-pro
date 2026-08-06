/**
 * Rotas de cobrança e assinatura.
 *
 *   POST /api/billing/checkout        → cria a cobrança e devolve o QR Pix (autenticado)
 *   GET  /api/billing/charge/:id      → status da cobrança, para o polling da página
 *   GET  /api/billing/refund/:id      → prévia do estorno pela política (admin)
 *   POST /api/billing/refund          → executa o estorno (admin)
 *   POST /api/billing/webhook         → notificação do Mercado Pago (público, por natureza)
 *
 * O webhook é o único endpoint público daqui, e isso é inevitável: quem chama é
 * o provedor, que não tem como se autenticar com um token nosso. A proteção tem
 * duas camadas, e a segunda é a que sustenta a primeira:
 *
 *  1. **Assinatura** (`x-signature`), quando `MERCADOPAGO_WEBHOOK_SECRET` está
 *     configurada: barra a forjaria antes de qualquer consulta ao provedor.
 *  2. **Não confiar no que entra**, sempre: o corpo da notificação é usado
 *     apenas para descobrir *qual* order consultar, e a verdade vem de um GET
 *     autenticado na API do Mercado Pago.
 *
 * A camada 2 é a que torna a 1 opcional — e não o contrário.
 */

import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware";
import { validate } from "../middleware/validate";
import { sendError } from "../lib/httpError";
import { logger } from "../lib/logger";
import { createCheckoutSchema, refundChargeSchema, uuidParamSchema } from "../schemas/requestSchemas";
import { getMercadoPagoConfig, isBillingEnabled } from "../config/mercadoPago";
import { requireAdmin } from "../middleware/requireAdmin";
import { verifyWebhookSignature } from "../lib/webhookSignature";
import {
  BillingError,
  confirmPaymentByOrderId,
  createCharge,
  getChargeStatus,
  previewRefund,
  refundCharge,
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
/**
 * ⚠️ **Este GET tem efeito colateral**, e a escolha foi consciente: quando a
 * cobrança está pendente, ele reconsulta o provedor e pode criar a assinatura.
 *
 * Um GET que altera estado é incomum e merece justificativa. A alternativa —
 * depender só do webhook — deixaria duas situações sem saída: pagamento cuja
 * notificação se perdeu (o backend hiberna no free tier) e desenvolvimento
 * local, onde o Mercado Pago nunca alcança `localhost`. Em ambas, quem pagou
 * ficaria esperando para sempre.
 *
 * A operação é idempotente e não destrutiva, então repetir o GET é seguro.
 */
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

// ── Estorno (administrativo) ────────────────────────────────────────────────
/**
 * Duas rotas, e a separação é o ponto:
 *
 *   GET  /refund/:id  → o que a política manda devolver, **sem tocar em dinheiro**
 *   POST /refund      → executa, exigindo que o valor confirmado bata com o cálculo
 *
 * Dá para ver a conta antes de mandar, e não dá para mandar um valor que a
 * política não sustenta. A Política de Reembolso publicada diz que o cliente
 * pede por e-mail e nós respondemos em até 5 dias úteis — então isto é
 * ferramenta de operação, não autoatendimento. O que se ganha é a conta certa e
 * o acesso encerrado no mesmo instante, sem SQL digitado à mão às 23h.
 */
router.get(
  "/refund/:id",
  requireAuth,
  requireAdmin,
  validate(uuidParamSchema, "params"),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    try {
      return res.json(await previewRefund(req.params.id));
    } catch (err) {
      if (err instanceof BillingError) {
        const status = err.code === "CHARGE_NOT_FOUND" ? 404 : 409;
        return sendError(res, status, err.code, err.message);
      }
      throw err;
    }
  })
);

router.post(
  "/refund",
  requireAuth,
  requireAdmin,
  validate(refundChargeSchema),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    if (!isBillingEnabled()) {
      return sendError(res, 503, "BILLING_DISABLED", "Cobrança indisponível no momento.");
    }

    const { chargeId, expectedCents } = req.body;
    const actor = req.user?.email ?? req.user?.id ?? "desconhecido";

    try {
      const outcome = await refundCharge({ chargeId, expectedCents, actor });
      return res.json(outcome);
    } catch (err) {
      if (err instanceof BillingError) {
        const status =
          err.code === "CHARGE_NOT_FOUND" ? 404
          : err.code === "PROVIDER_FAILED" ? 502
          : err.code === "AMOUNT_MISMATCH" || err.code === "ALREADY_PROCESSED" ? 409
          : 500;
        return sendError(res, status, err.code, err.message);
      }
      throw err;
    }
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

/**
 * Confere a assinatura da notificação — quando há segredo para conferir.
 *
 * **Opcional de propósito.** O segredo (`MERCADOPAGO_WEBHOOK_SECRET`) só existe
 * depois de cadastrar a URL do webhook no painel do Mercado Pago, e o código
 * precisou ser escrito antes disso. Sem o segredo, seguimos como antes: a
 * confirmação continua vindo de um `GET` autenticado na API, então uma
 * notificação forjada não libera acesso — ela só custa uma consulta.
 *
 * Com o segredo, a forjaria é barrada **antes** dessa consulta, que é o ganho
 * real: ninguém queima nosso limite na API do provedor a partir de uma URL
 * pública.
 *
 * O aviso de "sem segredo" sai **uma vez por processo**, não a cada
 * notificação: um alerta repetido a cada requisição vira ruído e some junto
 * com o resto do log.
 */
let avisouSemSegredo = false;

function assinaturaOk(req: { headers: Record<string, unknown>; query: unknown }): boolean {
  const secret = getMercadoPagoConfig()?.webhookSecret;

  if (!secret) {
    if (!avisouSemSegredo) {
      avisouSemSegredo = true;
      logger.warn(
        "[Billing] MERCADOPAGO_WEBHOOK_SECRET ausente — notificações aceitas sem conferir a " +
          "assinatura. A confirmação continua vindo da consulta autenticada à API, mas a URL " +
          "fica aberta a chamadas forjadas que custam requisições ao provedor."
      );
    }
    return true;
  }

  const header = (v: unknown) => (typeof v === "string" ? v : undefined);
  const q = (req.query ?? {}) as Record<string, unknown>;

  const veredito = verifyWebhookSignature({
    xSignature: header(req.headers["x-signature"]),
    xRequestId: header(req.headers["x-request-id"]),
    // O manifesto usa o `data.id` do QUERY STRING, não o do corpo — são o mesmo
    // valor, mas a especificação é explícita quanto à origem.
    dataId: header(q["data.id"]),
    secret,
  });

  if (!veredito.valid) {
    logger.warn({ motivo: veredito.reason }, "[Billing] Notificação com assinatura inválida — recusada");
    return false;
  }

  return true;
}

router.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    // 401 antes de qualquer trabalho: notificação que não prova a origem não
    // merece nem uma consulta ao provedor. É o único caso em que respondemos
    // erro sem ter tentado processar — e o Mercado Pago não reenvia o que ele
    // não assinou, porque ele assina tudo o que envia.
    if (!assinaturaOk(req)) {
      return sendError(res, 401, "INVALID_SIGNATURE", "Assinatura inválida.");
    }

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

      // Divergência de valor e cobrança sem dono são permanentes: reenviar a
      // notificação mil vezes dará o mesmo resultado. 200 encerra a fila de
      // retentativas — o `logger.error` do serviço é que pede atenção humana,
      // e o dinheiro fica visível em `billing_charges` para tratar à mão
      // (procedimento em docs/runbook-operacao.md).
      if (
        err instanceof BillingError &&
        (err.code === "AMOUNT_MISMATCH" || err.code === "USER_REQUIRED")
      ) {
        logger.error(
          { orderId, code: err.code },
          "[Billing] Notificação exige intervenção manual — não será reenviada"
        );
        return res.status(200).json({ received: true, needsReview: true });
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
