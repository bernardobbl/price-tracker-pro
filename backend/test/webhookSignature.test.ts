/**
 * Assinatura `x-signature` do Mercado Pago.
 *
 * Testar isto com vetor calculado à mão não provaria nada — o HMAC seria o
 * mesmo dos dois lados do erro. O que estes testes prendem é o **manifesto**:
 * a ordem dos campos, o `data.id` em minúsculas e o campo ausente que sai da
 * string em vez de virar vazio. É ali que uma integração de assinatura falha,
 * e o sintoma é sempre o mesmo — "nunca bate" — sem dizer o porquê.
 *
 * Referência: https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications
 */

import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { buildSignatureManifest, verifyWebhookSignature } from "../src/lib/webhookSignature";

const SECRET = "segredo-do-painel";
const DATA_ID = "ORD01JQ4S4KY8HWQ6NA5PXB65B3D3";
const REQUEST_ID = "2066ca19-c6f1-498a-be75-1923005edd06";
const TS = "1742505638683";

/** Assina como o Mercado Pago assinaria, para o teste ter o outro lado. */
function assinar(manifesto: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(manifesto).digest("hex");
}

describe("buildSignatureManifest", () => {
  it("segue o template `id:...;request-id:...;ts:...;`", () => {
    expect(buildSignatureManifest({ dataId: "abc", xRequestId: "req-1", ts: TS })).toBe(
      `id:abc;request-id:req-1;ts:${TS};`
    );
  });

  // A doc trata isto como nota de rodapé, e os ids de order do Mercado Pago
  // vêm SEMPRE em maiúsculas (`ORD01...`) — ou seja, esquecer o `toLowerCase`
  // não quebra "às vezes": quebra sempre, em produção, no primeiro pagamento.
  it("baixa o data.id para minúsculas", () => {
    expect(buildSignatureManifest({ dataId: DATA_ID, xRequestId: undefined, ts: TS })).toBe(
      `id:ord01jq4s4ky8hwq6na5pxb65b3d3;ts:${TS};`
    );
  });

  // Campo ausente é OMITIDO. `id:;request-id:;ts:x;` é outra string e outro
  // HMAC — a diferença entre validar e recusar tudo.
  it("omite o campo ausente em vez de deixar vazio", () => {
    expect(buildSignatureManifest({ dataId: undefined, xRequestId: undefined, ts: TS })).toBe(
      `ts:${TS};`
    );
    expect(buildSignatureManifest({ dataId: "abc", xRequestId: "", ts: TS })).toBe(
      `id:abc;ts:${TS};`
    );
  });
});

describe("verifyWebhookSignature", () => {
  const manifesto = `id:${DATA_ID.toLowerCase()};request-id:${REQUEST_ID};ts:${TS};`;

  it("aceita uma notificação assinada com o segredo certo", () => {
    const v1 = assinar(manifesto);

    expect(
      verifyWebhookSignature({
        xSignature: `ts=${TS},v1=${v1}`,
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
        secret: SECRET,
      })
    ).toEqual({ valid: true });
  });

  it("aceita independente da ordem e do espaçamento do header", () => {
    const v1 = assinar(manifesto);

    expect(
      verifyWebhookSignature({
        xSignature: ` v1=${v1} , ts=${TS} `,
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
        secret: SECRET,
      })
    ).toEqual({ valid: true });
  });

  it("recusa assinatura feita com outro segredo", () => {
    const v1 = assinar(manifesto, "segredo-de-outra-pessoa");

    expect(
      verifyWebhookSignature({
        xSignature: `ts=${TS},v1=${v1}`,
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
        secret: SECRET,
      })
    ).toEqual({ valid: false, reason: "NAO_CONFERE" });
  });

  // O ataque que a assinatura existe para barrar: trocar o id da order para
  // fazer o backend consultar outra coisa, reaproveitando uma assinatura vista.
  it("recusa quando o data.id foi trocado depois de assinado", () => {
    const v1 = assinar(manifesto);

    expect(
      verifyWebhookSignature({
        xSignature: `ts=${TS},v1=${v1}`,
        xRequestId: REQUEST_ID,
        dataId: "ORD-DE-OUTRA-PESSOA",
        secret: SECRET,
      })
    ).toEqual({ valid: false, reason: "NAO_CONFERE" });
  });

  it("distingue header ausente de header malformado — o log conta histórias diferentes", () => {
    const base = { xRequestId: REQUEST_ID, dataId: DATA_ID, secret: SECRET };

    expect(verifyWebhookSignature({ ...base, xSignature: undefined })).toEqual({
      valid: false,
      reason: "SEM_ASSINATURA",
    });
    expect(verifyWebhookSignature({ ...base, xSignature: "   " })).toEqual({
      valid: false,
      reason: "SEM_ASSINATURA",
    });
    // `ts` sem `v1`: veio algo, mas não dá para comparar com nada.
    expect(verifyWebhookSignature({ ...base, xSignature: `ts=${TS}` })).toEqual({
      valid: false,
      reason: "ASSINATURA_MALFORMADA",
    });
  });

  it("recusa hash de tamanho diferente sem estourar", () => {
    // `timingSafeEqual` lança quando os buffers têm tamanhos diferentes — um
    // v1 truncado viraria 500 em vez de 401 se isso não fosse tratado.
    expect(
      verifyWebhookSignature({
        xSignature: `ts=${TS},v1=abc`,
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
        secret: SECRET,
      })
    ).toEqual({ valid: false, reason: "NAO_CONFERE" });
  });
});
