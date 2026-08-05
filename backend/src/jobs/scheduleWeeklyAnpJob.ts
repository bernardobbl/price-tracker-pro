import cron from "node-cron";
import { ingestAnp } from "../ingest/anpIngestor";
import { evaluateAllFuelAlerts } from "../services/fuelAlertService";
import { applyRetention } from "../services/retentionService";
import { sendExpiryNotices } from "../services/expiryNoticeService";
import { logger } from "../lib/logger";

/**
 * Agendamento semanal da ingestão da ANP (G4).
 *
 * A ANP publica um novo levantamento **semanalmente**. Este job dispara a ingestão
 * uma vez por semana (padrão: segunda-feira 06:00), após a publicação do arquivo.
 *
 * "Delta" na prática: a ANP publica CSVs **mensais** (que crescem a cada semana até o
 * mês fechar). Os meses-alvo são **derivados da data de execução** (`buildAnpUrls` →
 * mês corrente + 2 anteriores), então o job acompanha o calendário sozinho — sem env
 * fixo que congelaria o dado. Não precisamos de diff manual: (1) o hash do conteúdo
 * **pula** arquivos que não mudaram (H2) e (2) o **upsert idempotente** pela chave
 * natural grava só o que é novo/alterado. Reprocessar o mesmo arquivo é barato e seguro.
 *
 * Timeout e retry do download já estão no `httpClient` (usado pelo `ingestAnp`).
 */

// Padrão: segunda 06:00 (após o levantamento semanal). Sobrescreva via env ANP_CRON.
// `ANP_CRON=off` desliga o agendamento embutido — é o modo recomendado em produção,
// onde quem dispara a ingestão é o GitHub Actions (`.github/workflows/ingest.yml`).
// Motivo: no free tier o processo web hiberna e reinicia, então um cron in-process
// pode simplesmente nunca chegar na hora marcada. O Actions roda independente disso.
const WEEKLY_CRON = process.env.ANP_CRON || "0 6 * * 1";

// Fuso do agendamento. Hosts de deploy rodam em UTC, então "0 6 * * 1" dispararia
// 03:00 no Brasil. Fixamos o fuso brasileiro (a ANP publica em horário local) e
// deixamos configurável por env.
const CRON_TIMEZONE = process.env.ANP_CRON_TZ || "America/Sao_Paulo";

async function runIngest(trigger: string): Promise<void> {
  logger.info({ trigger }, "[CRON][ANP] Iniciando ingestão da ANP");
  // ingestAnp nunca lança — encapsula o erro no ingestion_runs e no resultado.
  const result = await ingestAnp();
  logger.info(
    {
      status: result.status,
      rowsRead: result.rowsRead,
      rowsUpserted: result.rowsUpserted,
      rowsRejected: result.rowsRejected,
      durationMs: result.durationMs,
    },
    "[CRON][ANP] Ingestão finalizada"
  );

  // Só reavalia alertas quando houve dado novo (evita trabalho à toa em 304/skip).
  if (result.status === "success") {
    const { evaluated, notified } = await evaluateAllFuelAlerts();
    logger.info({ evaluated, notified }, "[CRON][ANP] Alertas reavaliados após ingestão");
  }

  // Fase 9 — retenção automática (free tier): mantém o banco num platô de tamanho.
  // Roda toda semana (mesmo em skip — barata e idempotente); nunca lança.
  await applyRetention();

  // Aviso de vencimento de assinatura. Fica FORA do `if (success)` de propósito:
  // ele não depende de a ANP ter publicado dado novo. Se ficasse lá dentro, uma
  // semana sem publicação deixaria o assinante sem aviso — e é justamente essa
  // falha silenciosa que ele existe para evitar. Nunca lança.
  const notices = await sendExpiryNotices();
  if (notices.eligible > 0) {
    logger.info(
      { eligible: notices.eligible, sent: notices.sent },
      "[CRON][ANP] Avisos de vencimento processados"
    );
  }
}

export function scheduleWeeklyAnpJob(): void {
  const disabled = WEEKLY_CRON.trim().toLowerCase();
  if (disabled === "off" || disabled === "false" || disabled === "0") {
    logger.info("[CRON][ANP] ANP_CRON desligado — ingestão a cargo do GitHub Actions");
  } else if (!cron.validate(WEEKLY_CRON)) {
    logger.error({ cron: WEEKLY_CRON }, "[CRON][ANP] Expressão cron inválida — job não agendado");
  } else {
    cron.schedule(WEEKLY_CRON, () => void runIngest("cron"), { timezone: CRON_TIMEZONE });
    logger.info(
      { cron: WEEKLY_CRON, timezone: CRON_TIMEZONE },
      "[CRON][ANP] Job semanal de ingestão agendado"
    );
  }

  // Ingestão imediata no boot (útil no 1º deploy / demo). Desligado por padrão.
  if (process.env.ANP_INGEST_ON_BOOT === "true") {
    logger.info("[CRON][ANP] ANP_INGEST_ON_BOOT=true — ingerindo agora");
    void runIngest("boot");
  }
}
