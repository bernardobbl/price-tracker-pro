import nodemailer from "nodemailer";
import { logger } from "../lib/logger";
import { montarConteudoAlerta, type SeriesRef } from "../lib/alertEmailContent";

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM;

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !EMAIL_FROM) {
    logger.warn(
      "[Email] Variáveis SMTP_HOST, SMTP_USER, SMTP_PASS ou EMAIL_FROM não configuradas. Emails não serão enviados."
    );
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    });
  }

  return transporter;
}

export interface PriceAlertEmailParams {
  to: string;
  /** Série do alerta (produto + local) — usada no texto e no link de volta. */
  series: SeriesRef;
  thresholdPrice: number;
  currentPrice: number;
  currency?: string;
  /** Data do levantamento que originou o alerta (opcional, dá contexto). */
  collectedAt?: string | null;
}

/**
 * Alerta de queda de preço.
 *
 * **Devolve `true` só quando o email realmente saiu.** Isso não é detalhe de
 * estilo: quem chama marca o alerta como "já avisado" depois desta função, e
 * durante semanas essa marca foi gravada sem que nada tivesse sido enviado —
 * o job rodava sem SMTP configurado, esta função caía no `return` mudo, e o
 * chamador tratava o silêncio como sucesso. Alerta marcado sem aviso é pior
 * que alerta não avaliado: ele nunca mais dispara.
 *
 * O `sendExpiryNoticeEmail` logo abaixo sempre fez assim — aqui é a correção
 * que alinha os dois.
 */
export async function sendPriceAlertEmail(params: PriceAlertEmailParams): Promise<boolean> {
  const tx = getTransporter();
  if (!tx) return false;

  // Assunto e corpo vivem numa função pura (testável sem enviar email).
  // O link aponta para o próprio app, na série do alerta — antes apontava para a
  // página da ANP, o que era inútil para quem só quer ver o próprio gráfico.
  const { subject, text } = montarConteudoAlerta({
    series: params.series,
    thresholdPrice: params.thresholdPrice,
    currentPrice: params.currentPrice,
    currency: params.currency,
    collectedAt: params.collectedAt,
    appUrl: process.env.FRONTEND_URL,
  });

  await tx.sendMail({
    from: EMAIL_FROM,
    to: params.to,
    subject,
    text
  });
  return true;
}

export interface ExpiryNoticeEmailParams {
  to: string;
  subject: string;
  text: string;
}

/**
 * Aviso de vencimento da assinatura.
 *
 * O conteúdo já vem pronto de `montarConteudoVencimento` (função pura, testável
 * sem enviar nada) — aqui só se despacha. Sem SMTP configurado, não envia e não
 * quebra: o job segue e o motivo fica no log.
 */
export async function sendExpiryNoticeEmail(params: ExpiryNoticeEmailParams) {
  const tx = getTransporter();
  if (!tx) return false;

  await tx.sendMail({
    from: EMAIL_FROM,
    to: params.to,
    subject: params.subject,
    text: params.text,
  });
  return true;
}

