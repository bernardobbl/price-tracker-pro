/**
 * O bloco `payer` da order — e a trava que impede `APRO` de vazar para produção.
 *
 * Contexto: um Pix de sandbox **não pode ser pago**. O código copia e cola do
 * ambiente de teste não é um Pix válido, e a conta de teste do Mercado Pago
 * também não paga QR. A saída oficial é `payer.first_name = "APRO"`, que faz a
 * order aprovar sozinha. Ver `buildPayer` no `mercadoPagoClient.ts`.
 *
 * Este teste existe por causa do lado perigoso disso: `APRO` em produção seria
 * uma order marcada como aprovada sem ninguém ter pago nada. A separação
 * depende de `MERCADOPAGO_ENV`, então é ela que se testa aqui.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const post = vi.hoisted(() => vi.fn());

vi.mock("axios", () => ({
  default: {
    create: () => ({ post, get: vi.fn() }),
    isAxiosError: () => false,
  },
}));

import { createPixOrder } from "../src/services/mercadoPagoClient";
import { __resetMercadoPagoConfig } from "../src/config/mercadoPago";

const RESPOSTA_OK = {
  data: {
    id: "ORD01",
    status: "action_required",
    transactions: {
      payments: [{ payment_method: { qr_code: "000201...", qr_code_base64: "", ticket_url: null } }],
    },
  },
};

const entrada = {
  amountCents: 5990,
  externalReference: "charge-1",
  payerEmail: "a@exemplo.com",
};

function payerEnviado() {
  return post.mock.calls[0][1].payer as Record<string, string>;
}

const envOriginal = { ...process.env };

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue(RESPOSTA_OK);
  __resetMercadoPagoConfig();
  process.env.MERCADOPAGO_ACCESS_TOKEN = "APP_USR-token-de-mentira-para-teste";
});

afterEach(() => {
  process.env = { ...envOriginal };
  __resetMercadoPagoConfig();
});

describe("payer da order — ambiente de teste", () => {
  it("manda first_name=APRO, sem o qual a order nunca sai de action_required", async () => {
    process.env.MERCADOPAGO_ENV = "test";
    await createPixOrder(entrada);

    expect(payerEnviado()).toEqual({
      email: "test_user_br@testuser.com",
      first_name: "APRO",
    });
  });

  it("usa email @testuser.com — a API recusa qualquer outro no sandbox", async () => {
    process.env.MERCADOPAGO_ENV = "test";
    await createPixOrder(entrada);

    expect(payerEnviado().email).toBe("test_user_br@testuser.com");
    expect(payerEnviado().email).not.toBe(entrada.payerEmail);
  });
});

describe("payer da order — produção", () => {
  it("NÃO manda APRO: seria order aprovada sem ninguém ter pago", async () => {
    process.env.NODE_ENV = "production";
    process.env.MERCADOPAGO_ENV = "production";
    await createPixOrder(entrada);

    expect(payerEnviado()).toEqual({ email: "a@exemplo.com" });
    expect(payerEnviado().first_name).toBeUndefined();
  });

  it("não inventa nome — o checkout não pede, e inventar seria pior que omitir", async () => {
    process.env.MERCADOPAGO_ENV = "production";
    await createPixOrder(entrada);

    expect(Object.keys(payerEnviado())).toEqual(["email"]);
  });
});

describe("o resto do corpo da order não muda com o ambiente", () => {
  it("valor, referência e método são os mesmos em teste e em produção", async () => {
    process.env.MERCADOPAGO_ENV = "test";
    await createPixOrder(entrada);
    const emTeste = { ...post.mock.calls[0][1] };

    post.mockReset();
    post.mockResolvedValue(RESPOSTA_OK);
    __resetMercadoPagoConfig();
    process.env.MERCADOPAGO_ENV = "production";
    await createPixOrder(entrada);
    const emProducao = { ...post.mock.calls[0][1] };

    expect(emTeste.total_amount).toBe("59.90");
    expect(emTeste.total_amount).toBe(emProducao.total_amount);
    expect(emTeste.external_reference).toBe(emProducao.external_reference);
    expect(emTeste.transactions).toEqual(emProducao.transactions);
  });

  it("usa a referência da cobrança como chave de idempotência", async () => {
    process.env.MERCADOPAGO_ENV = "test";
    await createPixOrder(entrada);

    expect(post.mock.calls[0][2].headers["X-Idempotency-Key"]).toBe("charge-1");
  });
});

describe("qr_code_base64 vazio (é o que o sandbox devolve)", () => {
  it("vira null em vez de string vazia — a página cai no copia e cola", async () => {
    process.env.MERCADOPAGO_ENV = "test";
    const order = await createPixOrder(entrada);

    // O sandbox devolve `qr_code_base64: ""`. Se isso virasse `<img src="data:...,">`
    // a tela mostraria um ícone de imagem quebrada onde deveria haver o QR.
    expect(order.brCodeBase64).toBeNull();
    expect(order.brCode).toBe("000201...");
  });
});

/**
 * O ambiente sobe junto com o QR.
 *
 * Consequência direta do teste acima: **em sandbox o QR nunca é desenhado** (o
 * base64 vem vazio), e o copia e cola que sobra não é aceito por banco nenhum.
 * Os dois fatos juntos produzem exatamente o relato de 05/ago/2026 — "o QR e o
 * código não levam a nada" — e nada na tela explicava o porquê.
 *
 * O front não tem como descobrir isso sozinho: ele não vê o token nem a env, e
 * o hostname não denuncia (frontend publicado pode apontar para backend em modo
 * teste). Só o backend sabe, então é o backend que precisa contar.
 */
describe("environment na resposta — é o que permite a tela avisar", () => {
  it("devolve `test` quando as credenciais são de sandbox", async () => {
    process.env.MERCADOPAGO_ENV = "test";
    const order = await createPixOrder(entrada);

    expect(order.environment).toBe("test");
  });

  it("devolve `production` com credenciais reais — e aí a tela não avisa nada", async () => {
    process.env.NODE_ENV = "production";
    process.env.MERCADOPAGO_ENV = "production";
    const order = await createPixOrder(entrada);

    expect(order.environment).toBe("production");
  });
});
