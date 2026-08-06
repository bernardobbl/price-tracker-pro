/**
 * Direitos do titular (LGPD art. 18).
 *
 *   GET    /api/account/export   → cópia dos dados, em JSON legível
 *   DELETE /api/account          → exclusão da conta, com anonimização do registro fiscal
 *
 * As duas são **autenticadas e agem sobre o próprio usuário do token**. Não
 * existe parâmetro de "qual conta" de propósito: um endpoint de exclusão que
 * aceita id de terceiro é uma arma apontada para o próprio pé, por mais checagem
 * que se ponha depois.
 */

import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth, type AuthenticatedRequest } from "../middleware/authMiddleware";
import { validate } from "../middleware/validate";
import { sendError } from "../lib/httpError";
import { deleteAccountSchema } from "../schemas/requestSchemas";
import { AccountError, deleteAccount, exportUserData } from "../services/accountService";

const router = Router();

router.get(
  "/export",
  requireAuth,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return sendError(res, 401, "UNAUTHENTICATED", "Usuário não autenticado.");

    try {
      const dados = await exportUserData(userId);

      // `Content-Disposition` faz o navegador baixar como arquivo em vez de
      // renderizar — "formato legível" inclui poder guardar o arquivo.
      const nome = `price-tracker-pro-meus-dados-${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader("Content-Disposition", `attachment; filename="${nome}"`);
      return res.json(dados);
    } catch (err) {
      if (err instanceof AccountError) {
        return sendError(res, err.code === "USER_NOT_FOUND" ? 404 : 503, err.code, err.message);
      }
      throw err;
    }
  })
);

router.delete(
  "/",
  requireAuth,
  validate(deleteAccountSchema),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return sendError(res, 401, "UNAUTHENTICATED", "Usuário não autenticado.");

    try {
      const resultado = await deleteAccount(userId);

      return res.json({
        excluida: true,
        ...resultado,
        // A mensagem entrega o número da cobrança quando ele existe. Depois da
        // anonimização, esse código é o ÚNICO jeito de localizar o pagamento —
        // não há mais nenhuma busca por pessoa que chegue nele. Mandar "peça
        // reembolso" sem o número seria mandar a pessoa a uma porta sem chave.
        mensagem: resultado.tinhaAssinaturaAtiva
          ? "Conta excluída. Você tinha acesso pago valendo — os registros de pagamento foram " +
            "mantidos de forma anônima por obrigação fiscal. GUARDE o(s) código(s) de cobrança " +
            `abaixo (${resultado.cobrancasParaReembolso.join(", ") || "nenhum"}): depois da ` +
            "exclusão eles são a única forma de identificar o pagamento num pedido de reembolso."
          : "Conta excluída. Favoritos e alertas foram apagados; registros de pagamento, se " +
            "houver, foram mantidos de forma anônima por obrigação fiscal (até 5 anos). " +
            (resultado.cobrancasParaReembolso.length
              ? `Guarde o(s) código(s) de cobrança: ${resultado.cobrancasParaReembolso.join(", ")}.`
              : ""),
      });
    } catch (err) {
      if (err instanceof AccountError) {
        return sendError(res, 503, err.code, err.message);
      }
      throw err;
    }
  })
);

export default router;
