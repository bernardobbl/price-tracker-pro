/**
 * Único ponto de contato com o Mercado Pago.
 *
 * Todo o resto do sistema fala com este arquivo, nunca com a API do provedor.
 * É o que torna a troca de gateway uma reescrita de **um arquivo** em vez de
 * uma cirurgia — decisão registrada em `docs/fase10-pagamentos.md`.
 *
 * Integração: Checkout Transparente via **API de Orders** (`POST /v1/orders`),
 * que é a solução escolhida na criação da aplicação. Documentação oficial:
 * https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/pix
 */

import axios from "axios";
import { randomUUID } from "node:crypto";
import { getMercadoPagoConfig, MERCADOPAGO_API } from "../config/mercadoPago";
import { logger } from "../lib/logger";

export class MercadoPagoError extends Error {
  code: "NOT_CONFIGURED" | "REQUEST_FAILED" | "UNEXPECTED_RESPONSE";
  httpStatus?: number;

  constructor(code: MercadoPagoError["code"], message: string, httpStatus?: number) {
    super(message);
    this.name = "MercadoPagoError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface CreatePixOrderInput {
  /** Valor em centavos. Vem do backend, nunca do cliente. */
  amountCents: number;
  /** Nosso identificador da cobrança — volta no webhook como `external_reference`. */
  externalReference: string;
  payerEmail: string;
  /** Validade do QR. Aceito pela API entre 30 minutos e 30 dias. */
  expiresInMinutes?: number;
}

export interface PixOrder {
  /** Id da order no Mercado Pago. */
  orderId: string;
  /** Código "copia e cola". */
  brCode: string;
  /** Imagem do QR em base64 (sem o prefixo `data:`). */
  brCodeBase64: string | null;
  /** Página pronta do Mercado Pago com o QR, alternativa ao nosso. */
  ticketUrl: string | null;
  status: string;
}

/** Status normalizado — o resto do sistema não precisa conhecer o vocabulário do provedor. */
export type NormalizedStatus = "pending" | "paid" | "expired" | "cancelled" | "refunded";

/** Formata centavos no formato que a API espera: string com 2 casas ("59.90"). */
function toAmountString(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Duração ISO 8601 a partir de minutos: 15 → "PT15M". */
function toIsoDuration(minutes: number): string {
  return `PT${Math.round(minutes)}M`;
}

function client() {
  const config = getMercadoPagoConfig();
  if (!config) {
    throw new MercadoPagoError(
      "NOT_CONFIGURED",
      "Mercado Pago não configurado — verifique MERCADOPAGO_ACCESS_TOKEN e MERCADOPAGO_ENV."
    );
  }
  return axios.create({
    baseURL: MERCADOPAGO_API,
    timeout: 15_000,
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
    },
  });
}

function describeError(err: unknown): { message: string; status?: number } {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    // A API devolve detalhe útil em `message`/`error`; não logamos o corpo inteiro
    // porque ele pode ecoar dados do pagador.
    const body = err.response?.data as { message?: string; error?: string } | undefined;
    const detail = body?.message || body?.error || err.message;
    return { message: status ? `HTTP ${status}: ${detail}` : detail, status };
  }
  return { message: err instanceof Error ? err.message : String(err) };
}

/**
 * Cria uma cobrança Pix e devolve o QR pronto.
 *
 * O header `X-Idempotency-Key` é **obrigatório** na API de Orders — e é um
 * presente: garante que uma retentativa de rede não vire duas cobranças.
 * Usamos o nosso `externalReference` como chave, então a mesma cobrança nunca
 * duplica no provedor, mesmo que a requisição seja repetida.
 */
export async function createPixOrder(input: CreatePixOrderInput): Promise<PixOrder> {
  const { amountCents, externalReference, payerEmail, expiresInMinutes = 30 } = input;
  const amount = toAmountString(amountCents);

  try {
    const { data } = await client().post(
      "/v1/orders",
      {
        type: "online",
        total_amount: amount,
        external_reference: externalReference,
        processing_mode: "automatic",
        transactions: {
          payments: [
            {
              amount,
              payment_method: { id: "pix", type: "bank_transfer" },
              expiration_time: toIsoDuration(expiresInMinutes),
            },
          ],
        },
        payer: { email: payerEmail },
      },
      {
        headers: {
          // Determinístico de propósito: retentar a MESMA cobrança não cria outra.
          "X-Idempotency-Key": externalReference,
        },
      }
    );

    const payment = data?.transactions?.payments?.[0];
    const method = payment?.payment_method;

    if (!data?.id || !method?.qr_code) {
      throw new MercadoPagoError(
        "UNEXPECTED_RESPONSE",
        "Resposta sem id da order ou sem qr_code — contrato da API mudou?"
      );
    }

    return {
      orderId: String(data.id),
      brCode: String(method.qr_code),
      brCodeBase64: method.qr_code_base64 ? String(method.qr_code_base64) : null,
      ticketUrl: method.ticket_url ? String(method.ticket_url) : null,
      status: String(data.status ?? "unknown"),
    };
  } catch (err) {
    if (err instanceof MercadoPagoError) throw err;
    const { message, status } = describeError(err);
    logger.error({ err: message, externalReference }, "[MercadoPago] Falha ao criar cobrança Pix");
    throw new MercadoPagoError("REQUEST_FAILED", message, status);
  }
}

export interface OrderSnapshot {
  orderId: string;
  externalReference: string | null;
  status: NormalizedStatus;
  rawStatus: string;
  amountCents: number | null;
}

/**
 * Traduz o vocabulário do provedor para o nosso.
 *
 * Exportada porque é lógica pura e merece teste próprio — é ela que decide se
 * alguém ganha acesso, então um `status` novo caindo no balde errado seria caro.
 * O default é `pending`: diante do desconhecido, **não** liberamos acesso.
 */
export function normalizeOrderStatus(raw: string | undefined | null): NormalizedStatus {
  switch ((raw ?? "").toLowerCase()) {
    case "processed":
    case "paid":
    case "approved":
    case "accredited":
      return "paid";
    case "expired":
      return "expired";
    case "cancelled":
    case "canceled":
    case "rejected":
      return "cancelled";
    case "refunded":
    case "charged_back":
      return "refunded";
    default:
      // action_required, processing, pending, e qualquer status futuro.
      return "pending";
  }
}

/**
 * Consulta o estado real de uma order.
 *
 * ⚠️ É esta função que dá a verdade sobre um pagamento — **nunca** o corpo do
 * webhook. O webhook é só um aviso de "algo mudou, vá conferir"; confiar nele
 * significaria aceitar que qualquer um que descubra a URL possa liberar acesso.
 */
export async function getOrder(orderId: string): Promise<OrderSnapshot> {
  try {
    const { data } = await client().get(`/v1/orders/${encodeURIComponent(orderId)}`);

    const rawStatus = String(data?.status ?? "");
    const total = data?.total_amount;

    return {
      orderId: String(data?.id ?? orderId),
      externalReference: data?.external_reference ? String(data.external_reference) : null,
      status: normalizeOrderStatus(rawStatus),
      rawStatus,
      amountCents: total != null ? Math.round(Number(total) * 100) : null,
    };
  } catch (err) {
    const { message, status } = describeError(err);
    logger.error({ err: message, orderId }, "[MercadoPago] Falha ao consultar order");
    throw new MercadoPagoError("REQUEST_FAILED", message, status);
  }
}

/** Id de idempotência para operações que não têm uma chave natural. */
export function newIdempotencyKey(): string {
  return randomUUID();
}
