import type { Response, NextFunction } from "express";
import { logger } from "../lib/logger";
import { sendError } from "../lib/httpError";
import type { AuthenticatedRequest } from "./authMiddleware";

/**
 * Restringe uma rota ao operador do serviço.
 *
 * ## Por que uma lista de e-mails, e não um papel no banco
 *
 * O projeto tem **um** operador. Criar tabela de papéis, tela de gestão e
 * migração para representar isso seria construir a estrutura de uma equipe que
 * não existe — e cada peça a mais é uma peça a mais para errar. Uma variável de
 * ambiente com os e-mails autorizados resolve o caso real, não guarda segredo
 * nenhum (é só uma lista de destinatários) e sai do caminho no dia em que
 * papéis de verdade forem necessários.
 *
 * ## Falha fechado, sempre
 *
 * Sem `ADMIN_EMAILS` configurada, **ninguém** é admin — nem em desenvolvimento.
 * O contrário (liberar geral quando a variável falta) transformaria um deploy
 * com env incompleta numa rota pública que devolve dinheiro.
 *
 * Usar **sempre depois** do `requireAuth`: este middleware confia no `req.user`
 * que aquele preencheu a partir do token validado no Supabase.
 */
function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const permitidos = adminEmails();

  if (permitidos.length === 0) {
    logger.error(
      "[Admin] ADMIN_EMAILS não configurada — rota administrativa bloqueada (fail-closed)."
    );
    return sendError(res, 503, "ADMIN_UNAVAILABLE", "Recurso administrativo indisponível.");
  }

  const email = req.user?.email?.trim().toLowerCase();

  if (!email || !permitidos.includes(email)) {
    // 404 em vez de 403: quem não é admin não precisa saber que a rota existe.
    logger.warn({ email: email ?? "(sem email)" }, "[Admin] Acesso negado a rota administrativa");
    return sendError(res, 404, "NOT_FOUND", "Recurso não encontrado.");
  }

  return next();
}
