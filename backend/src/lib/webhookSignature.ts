/**
 * Validação da assinatura `x-signature` das notificações do Mercado Pago.
 *
 * Especificação oficial (Checkout API Orders → Configurar notificações →
 * "Validar a origem da notificação"):
 * https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications
 *
 * ## O que isto acrescenta — e o que já era verdade sem ele
 *
 * O sistema **nunca** confiou no corpo da notificação: a confirmação de um
 * pagamento vem de um `GET` autenticado em `/v1/orders/{id}`. Uma requisição
 * forjada no webhook já não liberava acesso a ninguém — ela só fazia o backend
 * consultar uma order inexistente.
 *
 * O que a assinatura fecha é **o custo dessa consulta**: sem ela, quem
 * descobrisse a URL poderia disparar requisições e queimar nosso limite na API
 * do provedor (e, de quebra, encher o log). É defesa em profundidade, e é
 * assim que ela deve ser lida — não como a diferença entre seguro e inseguro.
 *
 * ## Por que NÃO recusamos por timestamp
 *
 * O `ts` do manifesto permite exigir que a notificação seja recente. Aqui isso
 * seria um tiro no pé: o Mercado Pago **reenvia a mesma notificação a cada 15
 * minutos** até receber 200, e o reenvio carrega a assinatura original. Uma
 * tolerância curta transformaria justamente a retentativa — o mecanismo que
 * existe para não perder um pagamento — em 401.
 *
 * E não há o que ganhar: reprocessar uma notificação repetida é inofensivo,
 * porque o processamento é idempotente e a verdade continua vindo da consulta
 * autenticada. Replay de uma notificação legítima não vale nada para o
 * atacante — ele só faz o backend reconferir algo que já sabe.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type SignatureVerdict =
  | { valid: true }
  | { valid: false; reason: "SEM_ASSINATURA" | "ASSINATURA_MALFORMADA" | "NAO_CONFERE" };

export interface VerifySignatureInput {
  /** Header `x-signature`: `ts=1742505638683,v1=ced36ab6...`. */
  xSignature: string | undefined;
  /** Header `x-request-id`. Ausente é aceitável — sai do manifesto. */
  xRequestId: string | undefined;
  /** Query param `data.id` da URL notificada. Ausente sai do manifesto. */
  dataId: string | undefined;
  secret: string;
}

/** Quebra `ts=...,v1=...` sem assumir ordem nem espaçamento. */
function parseSignatureHeader(header: string): { ts?: string; v1?: string } {
  const out: { ts?: string; v1?: string } = {};

  for (const parte of header.split(",")) {
    const igual = parte.indexOf("=");
    if (igual === -1) continue;
    const chave = parte.slice(0, igual).trim();
    const valor = parte.slice(igual + 1).trim();
    if (chave === "ts") out.ts = valor;
    if (chave === "v1") out.v1 = valor;
  }

  return out;
}

/**
 * Monta o manifesto exatamente como a documentação manda:
 *
 *     id:[data.id];request-id:[x-request-id];ts:[ts];
 *
 * Dois detalhes que a doc trata como nota de rodapé e são a causa clássica de
 * "a assinatura nunca bate":
 *
 *  1. **`data.id` vai em minúsculas** quando vier alfanumérico maiúsculo — e
 *     os ids de order do Mercado Pago vêm sempre assim (`ORD01JQ4S...`).
 *  2. **Campo ausente sai do manifesto**, não vira string vazia. `id:;` não é
 *     a mesma coisa que omitir o `id:`.
 *
 * Exportada para o teste poder olhar o manifesto, que é onde o erro mora.
 */
export function buildSignatureManifest(params: {
  dataId: string | undefined;
  xRequestId: string | undefined;
  ts: string;
}): string {
  const partes: string[] = [];

  const dataId = params.dataId?.trim().toLowerCase();
  if (dataId) partes.push(`id:${dataId}`);

  const requestId = params.xRequestId?.trim();
  if (requestId) partes.push(`request-id:${requestId}`);

  partes.push(`ts:${params.ts}`);

  return partes.join(";") + ";";
}

/** Comparação em tempo constante, tolerante a tamanhos diferentes. */
function equalsSeguro(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // `timingSafeEqual` lança se os tamanhos diferem — e o próprio lançamento
  // já vazaria a informação de tamanho. Sai antes, com a mesma resposta.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * A notificação veio mesmo do Mercado Pago?
 *
 * Função pura: recebe headers e o segredo, devolve veredito. Quem decide o que
 * fazer com um `false` é a rota — e o motivo vem junto porque "sem assinatura"
 * e "assinatura errada" contam histórias diferentes no log.
 */
export function verifyWebhookSignature(input: VerifySignatureInput): SignatureVerdict {
  if (!input.xSignature?.trim()) {
    return { valid: false, reason: "SEM_ASSINATURA" };
  }

  const { ts, v1 } = parseSignatureHeader(input.xSignature);
  if (!ts || !v1) {
    return { valid: false, reason: "ASSINATURA_MALFORMADA" };
  }

  const manifesto = buildSignatureManifest({
    dataId: input.dataId,
    xRequestId: input.xRequestId,
    ts,
  });

  const calculado = createHmac("sha256", input.secret).update(manifesto).digest("hex");

  return equalsSeguro(calculado, v1) ? { valid: true } : { valid: false, reason: "NAO_CONFERE" };
}
