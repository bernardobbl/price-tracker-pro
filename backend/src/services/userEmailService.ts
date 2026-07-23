/**
 * Resolução de email do usuário com cache (compartilhado entre domínios).
 *
 * Evita N chamadas `auth.admin.getUserById` numa mesma rodada (ex.: job que
 * avalia vários alertas do mesmo usuário). Emails mudam raramente; cache simples
 * basta. Extraído do alertService para reuso pelo domínio combustível.
 */

import { supabase } from "../config/supabaseClient";
import { logger } from "../lib/logger";

const emailCache = new Map<string, string | null>();

/** Limpa o cache de emails (usado em testes). */
export function __clearEmailCache() {
  emailCache.clear();
}

export async function getUserEmail(userId: string): Promise<string | null> {
  if (emailCache.has(userId)) return emailCache.get(userId) ?? null;
  if (!supabase) return null;

  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) {
    logger.error({ err: error.message }, "[UserEmail] Erro ao buscar usuário");
    return null;
  }

  const email = data?.user?.email ?? null;
  emailCache.set(userId, email);
  return email;
}
