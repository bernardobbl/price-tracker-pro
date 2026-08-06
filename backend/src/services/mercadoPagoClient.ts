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
import {
  getMercadoPagoConfig,
  MERCADOPAGO_API,
  type MercadoPagoEnv,
} from "../config/mercadoPago";
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
  /**
   * Ambiente que gerou este código — e ele precisa chegar até a tela.
   *
   * Um brCode de `test` **não é um Pix pagável**: nenhum banco o reconhece
   * (ver `buildPayer` abaixo). Sem este campo, o checkout mostra um QR
   * indistinguível do real, a pessoa tenta pagar, o banco recusa e não há nada
   * na tela explicando o porquê — foi exatamente o que aconteceu em 05/ago/2026.
   * O front não tem como deduzir isso sozinho: ele não vê o token nem a env.
   */
  environment: MercadoPagoEnv;
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
 * Monta o bloco `payer` — e aqui mora a única concessão ao ambiente de teste.
 *
 * ## Por que existe o `first_name: "APRO"`
 *
 * **Um Pix de sandbox não pode ser pago.** O código copia e cola devolvido no
 * ambiente de teste não é um Pix válido: nenhum banco o reconhece, e a conta de
 * teste do Mercado Pago também não paga QR de Pix. Sem uma saída, a order
 * ficaria em `action_required` para sempre e o fluxo completo jamais poderia
 * ser exercitado antes de mexer com dinheiro real — que é justamente quando
 * não se quer descobrir um erro.
 *
 * A saída oficial do Mercado Pago é uma **order de valores predefinidos**:
 * `payer.first_name = "APRO"` faz a order nascer `action_required` e mudar
 * sozinha para aprovada em seguida, como se alguém tivesse pago. Documentado em
 * https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-test/pix
 *
 * ## Por que isto não é um risco em produção
 *
 * O gatilho é `env === "test"`, que vem de `MERCADOPAGO_ENV` — e o config
 * **recusa o boot** com `NODE_ENV=production` + `MERCADOPAGO_ENV=test`. Não há
 * combinação em que produção envie `APRO`.
 *
 * Em produção o `payer` vai só com o email, que é o que temos: o checkout não
 * pede nome, e inventar um seria pior que omitir.
 *
 * ## Por que o email muda no sandbox
 *
 * A API recusa qualquer email que não termine em `@testuser.com` no ambiente de
 * teste (`invalid_email_for_sandbox`). O email real do usuário continua sendo
 * gravado na nossa cobrança — só não vai para o provedor enquanto estivermos
 * em `MERCADOPAGO_ENV=test`.
 */
const SANDBOX_PAYER_EMAIL = "test_user_br@testuser.com";

function buildPayer(payerEmail: string): Record<string, string> {
  const config = getMercadoPagoConfig();

  if (config?.env === "test") {
    logger.info(
      { emailReal: payerEmail },
      "[MercadoPago] Ambiente de teste: enviando payer.first_name=APRO e email @testuser.com (obrigatório no sandbox)."
    );
    return { email: SANDBOX_PAYER_EMAIL, first_name: "APRO" };
  }

  return { email: payerEmail };
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
        payer: buildPayer(payerEmail),
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
      // `client()` acima já garantiu que a config existe (ela lança se não).
      environment: getMercadoPagoConfig()?.env ?? "test",
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
  /**
   * Id da transação de pagamento dentro da order (`PAY01...`).
   *
   * Só é necessário para **estorno parcial**: a API do provedor exige apontar
   * qual transação está sendo devolvida. No estorno total o corpo vai vazio e
   * este campo não é usado. Buscamos na hora do estorno em vez de guardar no
   * banco porque é dado do provedor — se ele mudar, a verdade continua sendo a
   * consulta, nunca a nossa cópia.
   */
  paymentTransactionId: string | null;
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
    const paymentId = data?.transactions?.payments?.[0]?.id;

    return {
      orderId: String(data?.id ?? orderId),
      externalReference: data?.external_reference ? String(data.external_reference) : null,
      status: normalizeOrderStatus(rawStatus),
      rawStatus,
      amountCents: total != null ? Math.round(Number(total) * 100) : null,
      paymentTransactionId: paymentId ? String(paymentId) : null,
    };
  } catch (err) {
    const { message, status } = describeError(err);
    logger.error({ err: message, orderId }, "[MercadoPago] Falha ao consultar order");
    throw new MercadoPagoError("REQUEST_FAILED", message, status);
  }
}

export interface RefundResult {
  /** Status da order depois do estorno (`processed`, `refunded`…). */
  status: string;
  /** `refunded` ou `partially_refunded`, conforme o provedor. */
  statusDetail: string | null;
  /** Valor efetivamente devolvido, em centavos, quando o provedor informa. */
  refundedCents: number | null;
  /** Id do estorno no provedor — vai para o log e para o registro do suporte. */
  refundId: string | null;
}

/**
 * Estorna uma order, total ou parcialmente.
 *
 * ## O contrato da API, que não é óbvio
 *
 * - **Total:** corpo **vazio**. Mandar o valor cheio em vez de vazio é o erro
 *   clássico aqui — vira estorno parcial de 100%, que o provedor trata como
 *   caso diferente.
 * - **Parcial:** exige `transactions[].id` (o `PAY01...` da transação) além do
 *   valor. Por isso o `paymentTransactionId` do snapshot.
 * - Prazo: 180 dias a contar da aprovação.
 * - **Precisa haver saldo na conta.** Sem saldo, o provedor recusa — e é uma
 *   falha de negócio, não de código.
 *
 * ## Idempotência: determinística de propósito
 *
 * `X-Idempotency-Key` é obrigatório. Usamos uma chave derivada da cobrança e do
 * valor, e não um UUID novo a cada chamada: assim, dois cliques no mesmo
 * estorno batem na mesma chave e o provedor recusa o segundo em vez de devolver
 * o dinheiro duas vezes. Num fluxo que move dinheiro para fora, repetir é o
 * risco maior — preferimos falhar a duplicar.
 */
export async function refundOrder(params: {
  orderId: string;
  /** Omitido = estorno **total**. Informado = parcial. */
  amountCents?: number;
  /** Obrigatório no parcial: id da transação de pagamento na order. */
  paymentTransactionId?: string | null;
}): Promise<RefundResult> {
  const { orderId, amountCents, paymentTransactionId } = params;
  const parcial = amountCents != null;

  if (parcial && !paymentTransactionId) {
    throw new MercadoPagoError(
      "UNEXPECTED_RESPONSE",
      "Estorno parcial exige o id da transação de pagamento, que não veio na consulta da order."
    );
  }

  const body = parcial
    ? { transactions: [{ id: paymentTransactionId, amount: toAmountString(amountCents) }] }
    : {}; // total: corpo vazio, conforme a documentação

  const idempotencyKey = parcial ? `refund-${orderId}-${amountCents}` : `refund-${orderId}-total`;

  try {
    const { data } = await client().post(
      `/v1/orders/${encodeURIComponent(orderId)}/refund`,
      body,
      { headers: { "X-Idempotency-Key": idempotencyKey } }
    );

    const refund = data?.transactions?.refunds?.[0];
    const devolvido = refund?.amount;

    logger.info(
      {
        orderId,
        parcial,
        status: data?.status,
        statusDetail: data?.status_detail,
        refundId: refund?.id,
      },
      "[MercadoPago] Estorno processado"
    );

    return {
      status: String(data?.status ?? "unknown"),
      statusDetail: data?.status_detail ? String(data.status_detail) : null,
      refundedCents: devolvido != null ? Math.round(Number(devolvido) * 100) : null,
      refundId: refund?.id ? String(refund.id) : null,
    };
  } catch (err) {
    const { message, status } = describeError(err);
    logger.error({ err: message, orderId, parcial }, "[MercadoPago] Falha ao estornar");
    throw new MercadoPagoError("REQUEST_FAILED", message, status);
  }
}

/** Id de idempotência para operações que não têm uma chave natural. */
export function newIdempotencyKey(): string {
  return randomUUID();
}
