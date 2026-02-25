import type { Request, Response, NextFunction } from "express";
import { supabase } from "../config/supabaseClient";

export interface AuthenticatedUser {
  id: string;
  email?: string | null;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  // Se Supabase não estiver configurado, não força auth (modo demo/local)
  if (!supabase) {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token de autenticação ausente." });
  }

  const token = authHeader.slice("Bearer ".length);

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({ error: "Token de autenticação inválido." });
    }

    req.user = {
      id: data.user.id,
      email: data.user.email
    };

    return next();
  } catch (err) {
    console.error("[Auth] Erro ao validar token:", err);
    return res.status(500).json({ error: "Erro ao validar autenticação." });
  }
}

