import type { Request, Response, NextFunction } from "express";
import { supabase } from "../config/supabaseClient";
import { logger } from "../lib/logger";
import { sendError } from "../lib/httpError";

export interface AuthenticatedUser {
  id: string;
  email?: string | null;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  // Supabase ausente: liberar SEM autenticação só é aceitável em dev (modo demo/local).
  // Em produção falhamos fechado — nunca expor dados sem auth por causa de env faltando.
  if (!supabase) {
    if (IS_PRODUCTION) {
      logger.error("[Auth] Supabase não configurado em produção — acesso bloqueado (fail-closed).");
      return sendError(res, 503, "AUTH_UNAVAILABLE", "Autenticação indisponível no momento.");
    }
    logger.warn("[Auth] Supabase não configurado — bypass de autenticação (apenas dev/demo).");
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return sendError(res, 401, "AUTH_MISSING", "Token de autenticação ausente.");
  }

  const token = authHeader.slice("Bearer ".length);

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return sendError(res, 401, "AUTH_INVALID", "Token de autenticação inválido.");
    }

    req.user = {
      id: data.user.id,
      email: data.user.email
    };

    return next();
  } catch (err) {
    logger.error({ err }, "[Auth] Erro ao validar token");
    return sendError(res, 500, "AUTH_ERROR", "Erro ao validar autenticação.");
  }
}
