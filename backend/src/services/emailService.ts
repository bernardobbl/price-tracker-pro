import nodemailer from "nodemailer";

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM;

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !EMAIL_FROM) {
    console.warn(
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
  productId: string;
  productName: string;
  thresholdPrice: number;
  currentPrice: number;
  currency: string;
  url: string;
}

export async function sendPriceAlertEmail(params: PriceAlertEmailParams) {
  const tx = getTransporter();
  if (!tx) return;

  const { to, productId, productName, thresholdPrice, currentPrice, currency, url } = params;

  const subject = `Alerta de preço - ${productName} (${productId})`;

  const text = [
    `O preço do produto "${productName}" atingiu o valor desejado.`,
    "",
    `Produto: ${productName} (${productId})`,
    `Preço atual: ${currency} ${currentPrice.toFixed(2)}`,
    `Alvo do alerta: ${currency} ${thresholdPrice.toFixed(2)}`,
    "",
    `Veja mais detalhes no link: ${url}`,
    "",
    "Se você não deseja mais receber este alerta, desative-o na sua conta."
  ].join("\n");

  await tx.sendMail({
    from: EMAIL_FROM,
    to,
    subject,
    text
  });
}

