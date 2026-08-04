/**
 * Varredura de assinaturas próximas do vencimento e envio do aviso.
 *
 * Roda junto do job semanal da ANP (`scheduleWeeklyAnpJob` / GitHub Actions),
 * reaproveitando agendador e SMTP que já existem. É a Etapa B do plano de
 * pagamentos — trazida para primeiro lugar porque é a promessa de maior risco
 * (falha em silêncio) e a de menor esforço.
 *
 * Nunca lança: um erro aqui não pode derrubar a ingestão da ANP, que é a função
 * principal do job.
 */

import { supabase } from "../config/supabaseClient";
import { logger } from "../lib/logger";
import { getUserEmail } from "./userEmailService";
import { sendExpiryNoticeEmail } from "./emailService";
import {
  montarConteudoVencimento,
  selectSubscriptionsToWarn,
  NOTICE_WINDOW_DAYS,
  type SubscriptionForNotice,
} from "../lib/expiryNotice";
import type { PlanKey } from "../lib/subscriptionPeriod";

export interface ExpiryNoticeResult {
  /** Assinaturas ativas examinadas. */
  scanned: number;
  /** Elegíveis ao aviso nesta rodada. */
  eligible: number;
  /** Avisos efetivamente enviados. */
  sent: number;
}

const EMPTY: ExpiryNoticeResult = { scanned: 0, eligible: 0, sent: 0 };

/**
 * Envia o aviso de vencimento de quem está na janela e ainda não foi avisado.
 *
 * Nota de escala: hoje carregamos todas as assinaturas ativas e resolvemos em
 * memória qual é a de maior vigência por usuário. Isso é adequado para dezenas
 * ou centenas de linhas. Passando disso, vale mover o "última por usuário" para
 * uma view com `distinct on (user_id)` no Postgres.
 */
export async function sendExpiryNotices(now: Date = new Date()): Promise<ExpiryNoticeResult> {
  if (!supabase) {
    logger.warn("[ExpiryNotice] Supabase não configurado — varredura pulada.");
    return EMPTY;
  }

  try {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("id, user_id, plan, expires_at, warned_at")
      .eq("status", "active")
      .gt("expires_at", now.toISOString());

    if (error) {
      logger.error({ err: error.message }, "[ExpiryNotice] Falha ao listar assinaturas");
      return EMPTY;
    }

    const rows = data ?? [];
    if (rows.length === 0) return EMPTY;

    // Resolve o email de cada dono. `user_id` nulo = linha anonimizada a pedido
    // do titular (LGPD): não há para quem avisar, então sai da lista.
    const candidatos: SubscriptionForNotice[] = [];
    for (const row of rows) {
      const userId = row.user_id as string | null;
      if (!userId) continue;

      const email = await getUserEmail(userId);
      if (!email) continue;

      candidatos.push({
        id: row.id as string,
        userId,
        email,
        plan: row.plan as PlanKey,
        expiresAt: new Date(row.expires_at as string),
        warnedAt: row.warned_at ? new Date(row.warned_at as string) : null,
      });
    }

    const aAvisar = selectSubscriptionsToWarn({ subscriptions: candidatos, now });

    let sent = 0;
    for (const sub of aAvisar) {
      const { subject, text } = montarConteudoVencimento({
        plan: sub.plan,
        expiresAt: sub.expiresAt,
        now,
        appUrl: process.env.FRONTEND_URL,
      });

      try {
        const enviado = await sendExpiryNoticeEmail({ to: sub.email, subject, text });

        // Só marca como avisado se o email realmente saiu. Marcar antes faria a
        // pessoa nunca mais ser avisada por causa de uma falha momentânea de SMTP.
        if (enviado) {
          const { error: updateError } = await supabase
            .from("subscriptions")
            .update({ warned_at: now.toISOString() })
            .eq("id", sub.id);

          if (updateError) {
            // Email saiu mas a marca falhou: a pessoa pode receber de novo na
            // semana que vem. Chato, mas melhor do que não ser avisada.
            logger.error(
              { err: updateError.message, id: sub.id },
              "[ExpiryNotice] Aviso enviado mas warned_at não foi gravado"
            );
          }
          sent += 1;
        }
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : String(err), id: sub.id },
          "[ExpiryNotice] Falha ao enviar aviso — segue para o próximo"
        );
      }
    }

    logger.info(
      { scanned: rows.length, eligible: aAvisar.length, sent, windowDays: NOTICE_WINDOW_DAYS },
      "[ExpiryNotice] Varredura de vencimento concluída"
    );

    return { scanned: rows.length, eligible: aAvisar.length, sent };
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[ExpiryNotice] Erro inesperado na varredura"
    );
    return EMPTY;
  }
}
