/**
 * `billingService` — a orquestração que decide quem ganha acesso pago.
 *
 * Por que este arquivo existe: é aqui que erro vira dinheiro. Um pagamento
 * confirmado duas vezes dobra a vigência; um `user_id` nulo aceito vira receita
 * sem ninguém liberado; um valor não conferido vende um ano por qualquer preço.
 * Nenhum desses caminhos é exercitado pelos testes de vigência ou de status —
 * eles cobrem funções puras, e o risco mora na costura entre elas.
 *
 * O Supabase e o Mercado Pago são falsos aqui. O que se testa é a DECISÃO:
 * quando inserir, quando recusar, e o que exatamente vai para o banco.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Supabase falso ──────────────────────────────────────────────────────────
// Encadeamento preguiçoso: cada `from()` devolve um builder novo que grava o
// que foi chamado. O builder é "thenable" porque o código faz
// `await supabase.from(x).insert(y)` sem nenhum `.single()` no fim.
const h = vi.hoisted(() => ({
  /** Linha devolvida por `select … maybeSingle()` em billing_charges. */
  chargeRow: null as Record<string, unknown> | null,
  chargeSelectError: null as { message: string } | null,
  /** Resultado do insert em billing_charges. */
  chargeInsert: { data: { id: "charge-1" }, error: null } as {
    data: { id: string } | null;
    error: { message: string } | null;
  },
  /** Linha de assinatura ativa devolvida a `getActiveSubscription`. */
  activeSubRow: null as Record<string, unknown> | null,
  /** Erro do insert em subscriptions (ex.: `{ code: "23505" }`). */
  subInsertError: null as { code?: string; message: string } | null,

  // Registro do que aconteceu
  chargeInserts: [] as Record<string, unknown>[],
  chargeUpdates: [] as Array<{ payload: Record<string, unknown>; eq: Array<[string, unknown]> }>,
  subInserts: [] as Record<string, unknown>[],
  chargeSelectEq: [] as Array<[string, unknown]>,
}));

vi.mock("../src/config/supabaseClient", () => {
  type Result = { data?: unknown; error: unknown };

  function makeBuilder(table: string) {
    let op = "select";
    let payload: Record<string, unknown> = {};
    const eq: Array<[string, unknown]> = [];

    function resolve(): Result {
      if (table === "billing_charges") {
        if (op === "insert") return { data: h.chargeInsert.data, error: h.chargeInsert.error };
        if (op === "update") return { data: null, error: null };
        return { data: h.chargeRow, error: h.chargeSelectError };
      }
      // subscriptions
      if (op === "insert") return { data: null, error: h.subInsertError };
      return { data: h.activeSubRow, error: null };
    }

    const builder = {
      select() {
        return builder;
      },
      insert(p: Record<string, unknown>) {
        op = "insert";
        payload = p;
        if (table === "billing_charges") h.chargeInserts.push(p);
        else h.subInserts.push(p);
        return builder;
      },
      update(p: Record<string, unknown>) {
        op = "update";
        payload = p;
        return builder;
      },
      eq(column: string, value: unknown) {
        eq.push([column, value]);
        if (table === "billing_charges" && op === "update") {
          h.chargeUpdates.push({ payload, eq: [...eq] });
        }
        if (table === "billing_charges" && op === "select") {
          h.chargeSelectEq.push([column, value]);
        }
        return builder;
      },
      gt: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => resolve(),
      single: async () => resolve(),
      // `await supabase.from(...).insert(...)` cai aqui
      then(onOk: (v: Result) => unknown, onErr?: (e: unknown) => unknown) {
        return Promise.resolve(resolve()).then(onOk, onErr);
      },
    };
    return builder;
  }

  return { supabase: { from: (table: string) => makeBuilder(table) } };
});

// ── Mercado Pago falso ──────────────────────────────────────────────────────
const mp = vi.hoisted(() => ({
  createPixOrder: vi.fn(),
  getOrder: vi.fn(),
}));

vi.mock("../src/services/mercadoPagoClient", () => ({
  createPixOrder: mp.createPixOrder,
  getOrder: mp.getOrder,
}));

// ── Comprovante de pagamento ────────────────────────────────────────────────
// Falsos para poder afirmar DUAS coisas opostas: que o e-mail sai com os dados
// certos, e que quando ele falha o pagamento continua valendo. A segunda é a
// que importa mais — ver `enviarComprovante` no serviço.
const mail = vi.hoisted(() => ({
  getUserEmail: vi.fn(),
  sendPaymentConfirmationEmail: vi.fn(),
}));

vi.mock("../src/services/userEmailService", () => ({
  getUserEmail: mail.getUserEmail,
}));

vi.mock("../src/services/emailService", () => ({
  sendPaymentConfirmationEmail: mail.sendPaymentConfirmationEmail,
}));

import {
  BillingError,
  confirmPaymentByOrderId,
  createCharge,
  getChargeStatus,
} from "../src/services/billingService";
import { PLAN_PRICE_CENTS } from "../src/lib/subscriptionPeriod";

const CHARGE_ID = "charge-1";
const USER = "user-a";
const ORDER = "MP-ORDER-999";

const cobrancaPendente = (over: Record<string, unknown> = {}) => ({
  id: CHARGE_ID,
  user_id: USER,
  plan: "anual",
  amount_cents: PLAN_PRICE_CENTS.anual,
  status: "pending",
  legal_version: "1.0",
  accepted_at: "2026-08-04T10:00:00.000Z",
  ...over,
});

const orderPaga = (over: Record<string, unknown> = {}) => ({
  orderId: ORDER,
  externalReference: CHARGE_ID,
  status: "paid",
  rawStatus: "processed",
  amountCents: PLAN_PRICE_CENTS.anual,
  ...over,
});

beforeEach(() => {
  h.chargeRow = null;
  h.chargeSelectError = null;
  h.chargeInsert = { data: { id: CHARGE_ID }, error: null };
  h.activeSubRow = null;
  h.subInsertError = null;
  h.chargeInserts = [];
  h.chargeUpdates = [];
  h.subInserts = [];
  h.chargeSelectEq = [];
  mp.createPixOrder.mockReset();
  mp.getOrder.mockReset();
  mail.getUserEmail.mockReset();
  mail.sendPaymentConfirmationEmail.mockReset();
  mail.getUserEmail.mockResolvedValue("cliente@exemplo.com");
  mail.sendPaymentConfirmationEmail.mockResolvedValue(true);
});

// ═══════════════════════════════════════════════════════════════════════════
describe("createCharge — o preço vem do plano, nunca do cliente", () => {
  beforeEach(() => {
    mp.createPixOrder.mockResolvedValue({
      orderId: ORDER,
      brCode: "000201...",
      brCodeBase64: "iVBORw0KG",
      ticketUrl: "https://www.mercadopago.com.br/payments/123/ticket",
      status: "action_required",
      environment: "test",
    });
  });

  // ── O ambiente precisa chegar à tela ─────────────────────────────────────
  // Um brCode de sandbox é visualmente idêntico ao real e nenhum banco o
  // aceita. Sem este campo o checkout não tem como avisar, e o sintoma vira
  // "o QR não funciona" — que foi como chegou em 05/ago/2026.
  it("devolve o ambiente do provedor junto com o QR", async () => {
    const charge = await createCharge({
      userId: USER, plan: "anual", email: "a@b.c", legalVersion: "1.0",
    });

    expect(charge.environment).toBe("test");
  });

  it("assume `test` quando o provedor não informa o ambiente — na dúvida, avisa", async () => {
    mp.createPixOrder.mockResolvedValue({
      orderId: ORDER, brCode: "000201...", brCodeBase64: null,
      ticketUrl: null, status: "action_required",
      // sem `environment` (servidor/mock antigo)
    });

    const charge = await createCharge({
      userId: USER, plan: "anual", email: "a@b.c", legalVersion: "1.0",
    });

    // Falha para o lado do aviso: mostrar "código de teste" num código real é
    // constrangedor; esconder isso num código de teste custa uma reclamação.
    expect(charge.environment).toBe("test");
  });

  it("repassa o ticketUrl do provedor — é a alternativa de quem não lê o QR", async () => {
    const charge = await createCharge({
      userId: USER, plan: "anual", email: "a@b.c", legalVersion: "1.0",
    });

    expect(charge.ticketUrl).toBe("https://www.mercadopago.com.br/payments/123/ticket");
  });

  it("grava o valor do plano anual, e o front não tem como influenciar", async () => {
    await createCharge({ userId: USER, plan: "anual", email: "a@b.c", legalVersion: "1.0" });

    expect(h.chargeInserts[0].amount_cents).toBe(PLAN_PRICE_CENTS.anual);
    expect(h.chargeInserts[0].amount_cents).toBe(5990);
  });

  it("grava o valor do plano mensal", async () => {
    await createCharge({ userId: USER, plan: "mensal", email: "a@b.c", legalVersion: "1.0" });

    expect(h.chargeInserts[0].amount_cents).toBe(PLAN_PRICE_CENTS.mensal);
    expect(h.chargeInserts[0].amount_cents).toBe(1690);
  });

  it("pede ao provedor o MESMO valor que gravou, e usa o id da cobrança como referência", async () => {
    await createCharge({ userId: USER, plan: "anual", email: "a@b.c", legalVersion: "1.0" });

    expect(mp.createPixOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: PLAN_PRICE_CENTS.anual,
        externalReference: CHARGE_ID,
        payerEmail: "a@b.c",
      })
    );
  });

  it("carimba o aceite com a hora do SERVIDOR (o cliente não manda data)", async () => {
    const antes = Date.now();
    await createCharge({ userId: USER, plan: "anual", email: "a@b.c", legalVersion: "1.0" });
    const gravado = new Date(h.chargeInserts[0].accepted_at as string).getTime();

    expect(gravado).toBeGreaterThanOrEqual(antes);
    expect(gravado).toBeLessThanOrEqual(Date.now());
    expect(h.chargeInserts[0].legal_version).toBe("1.0");
  });

  it("nasce como 'pending' — nada é liberado antes da confirmação", async () => {
    await createCharge({ userId: USER, plan: "anual", email: "a@b.c", legalVersion: "1.0" });
    expect(h.chargeInserts[0].status).toBe("pending");
  });
});

describe("createCharge — quando o provedor recusa", () => {
  it("marca a cobrança como cancelada em vez de deixá-la pendente para sempre", async () => {
    mp.createPixOrder.mockRejectedValue(new Error("chave Pix não cadastrada"));

    await expect(
      createCharge({ userId: USER, plan: "anual", email: "a@b.c", legalVersion: "1.0" })
    ).rejects.toMatchObject({ code: "PROVIDER_FAILED" });

    expect(h.chargeUpdates.at(-1)?.payload).toMatchObject({ status: "cancelled" });
    expect(h.chargeUpdates.at(-1)?.eq).toContainEqual(["id", CHARGE_ID]);
  });

  it("não vaza a mensagem do provedor para o cliente", async () => {
    mp.createPixOrder.mockRejectedValue(new Error("token APP_USR-123 inválido"));

    await expect(
      createCharge({ userId: USER, plan: "anual", email: "a@b.c", legalVersion: "1.0" })
    ).rejects.toThrow(/Não foi possível gerar o pagamento agora/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("confirmPaymentByOrderId — caminho feliz", () => {
  it("cria a assinatura quando a API confirma o pagamento", async () => {
    h.chargeRow = cobrancaPendente();
    mp.getOrder.mockResolvedValue(orderPaga());

    const r = await confirmPaymentByOrderId(ORDER);

    expect(r).toMatchObject({ created: true, status: "paid", chargeId: CHARGE_ID });
    expect(h.subInserts).toHaveLength(1);
    expect(h.subInserts[0]).toMatchObject({
      user_id: USER,
      plan: "anual",
      status: "active",
      provider: "mercadopago",
      charge_id: CHARGE_ID,
      amount_cents: PLAN_PRICE_CENTS.anual,
    });
  });

  it("a verdade vem da API, não do que estava salvo — consulta a order sempre", async () => {
    h.chargeRow = cobrancaPendente();
    mp.getOrder.mockResolvedValue(orderPaga());

    await confirmPaymentByOrderId(ORDER);
    expect(mp.getOrder).toHaveBeenCalledWith(ORDER);
  });

  it("copia a prova do aceite (versão + hora) da cobrança para a assinatura", async () => {
    h.chargeRow = cobrancaPendente();
    mp.getOrder.mockResolvedValue(orderPaga());

    await confirmPaymentByOrderId(ORDER);
    expect(h.subInserts[0]).toMatchObject({
      legal_version: "1.0",
      accepted_at: "2026-08-04T10:00:00.000Z",
    });
  });

  it("vigência do anual é de 12 meses de calendário, não 365 dias", async () => {
    h.chargeRow = cobrancaPendente();
    mp.getOrder.mockResolvedValue(orderPaga());

    await confirmPaymentByOrderId(ORDER);

    const inicio = new Date(h.subInserts[0].starts_at as string);
    const fim = new Date(h.subInserts[0].expires_at as string);
    expect(fim.getUTCFullYear()).toBe(inicio.getUTCFullYear() + 1);
    expect(fim.getUTCMonth()).toBe(inicio.getUTCMonth());
  });

  it("renovação antecipada SOMA ao saldo — a pessoa não perde o que já pagou", async () => {
    const daquiA10Dias = new Date(Date.now() + 10 * 86_400_000);
    h.chargeRow = cobrancaPendente({ plan: "mensal", amount_cents: PLAN_PRICE_CENTS.mensal });
    h.activeSubRow = {
      plan: "mensal",
      starts_at: new Date().toISOString(),
      expires_at: daquiA10Dias.toISOString(),
    };
    mp.getOrder.mockResolvedValue(orderPaga({ amountCents: PLAN_PRICE_CENTS.mensal }));

    await confirmPaymentByOrderId(ORDER);

    const fim = new Date(h.subInserts[0].expires_at as string);
    // Base é o vencimento atual, não "agora": ~41 dias, nunca ~31.
    const dias = (fim.getTime() - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(35);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// O COMPROVANTE
//
// Os Termos prometem por escrito que a confirmação de pagamento chega por
// e-mail, e durante toda a construção do checkout nada era enviado. O risco de
// consertar isso é criar um problema pior que o original: uma falha de SMTP
// derrubando a confirmação de um pagamento que já entrou. Daí o segundo bloco.
// ═══════════════════════════════════════════════════════════════════════════
describe("confirmPaymentByOrderId — comprovante", () => {
  beforeEach(() => {
    h.chargeRow = cobrancaPendente();
    mp.getOrder.mockResolvedValue(orderPaga());
  });

  it("envia o comprovante para o email do usuário quando a assinatura nasce", async () => {
    await confirmPaymentByOrderId(ORDER);

    expect(mail.getUserEmail).toHaveBeenCalledWith(USER);
    expect(mail.sendPaymentConfirmationEmail).toHaveBeenCalledOnce();
    expect(mail.sendPaymentConfirmationEmail.mock.calls[0][0].to).toBe("cliente@exemplo.com");
  });

  it("o comprovante leva valor, validade e o código da cobrança", async () => {
    await confirmPaymentByOrderId(ORDER);

    const { subject, text } = mail.sendPaymentConfirmationEmail.mock.calls[0][0];
    expect(subject).toMatch(/Premium anual/);
    expect(text).toContain("R$ 59,90");
    expect(text).toContain(CHARGE_ID); // a alça para pedir reembolso depois
  });

  // O webhook chega repetido por garantia do provedor. Sem esta saída, cada
  // reenvio mandaria outro comprovante da MESMA compra.
  it("não reenvia quando a cobrança já estava paga", async () => {
    h.chargeRow = cobrancaPendente({ status: "paid" });

    await confirmPaymentByOrderId(ORDER);

    expect(mail.sendPaymentConfirmationEmail).not.toHaveBeenCalled();
  });

  it("order ainda não paga não gera comprovante", async () => {
    mp.getOrder.mockResolvedValue(orderPaga({ status: "pending", rawStatus: "action_required" }));

    await confirmPaymentByOrderId(ORDER);

    expect(mail.sendPaymentConfirmationEmail).not.toHaveBeenCalled();
  });
});

describe("confirmPaymentByOrderId — o comprovante NÃO pode derrubar o pagamento", () => {
  beforeEach(() => {
    h.chargeRow = cobrancaPendente();
    mp.getOrder.mockResolvedValue(orderPaga());
  });

  // Esta é a razão de existir o try/catch em `enviarComprovante`. Se o erro
  // subisse, o webhook responderia 500, o Mercado Pago reenviaria em laço até o
  // SMTP voltar, e a tela de quem pagou seguiria dizendo "aguardando" por causa
  // de um e-mail. "Não recebi o comprovante" e "paguei e não liberou" são
  // problemas de ordens de grandeza diferentes.
  it("SMTP explodindo não impede a assinatura", async () => {
    mail.sendPaymentConfirmationEmail.mockRejectedValue(new Error("SMTP fora"));

    const r = await confirmPaymentByOrderId(ORDER);

    expect(r.created).toBe(true);
    expect(r.status).toBe("paid");
    expect(h.subInserts).toHaveLength(1);
  });

  it("SMTP não configurado (devolve false) também não impede", async () => {
    mail.sendPaymentConfirmationEmail.mockResolvedValue(false);

    const r = await confirmPaymentByOrderId(ORDER);

    expect(r.created).toBe(true);
    expect(h.subInserts).toHaveLength(1);
  });

  // Conta sem email é possível: a coluna vem do provedor de auth, não é nossa.
  it("usuário sem email não impede — libera o acesso e registra o motivo", async () => {
    mail.getUserEmail.mockResolvedValue(null);

    const r = await confirmPaymentByOrderId(ORDER);

    expect(r.created).toBe(true);
    expect(mail.sendPaymentConfirmationEmail).not.toHaveBeenCalled();
  });

  it("falha ao BUSCAR o email também não impede", async () => {
    mail.getUserEmail.mockRejectedValue(new Error("auth fora do ar"));

    const r = await confirmPaymentByOrderId(ORDER);

    expect(r.created).toBe(true);
    expect(h.subInserts).toHaveLength(1);
  });
});

describe("confirmPaymentByOrderId — idempotência (o webhook chega repetido)", () => {
  it("1ª camada: cobrança já 'paid' não cria segunda assinatura", async () => {
    h.chargeRow = cobrancaPendente({ status: "paid" });
    mp.getOrder.mockResolvedValue(orderPaga());

    const r = await confirmPaymentByOrderId(ORDER);

    expect(r).toMatchObject({ created: false, status: "paid" });
    expect(h.subInserts).toHaveLength(0); // ← a vigência não dobra
  });

  it("2ª camada: violação do índice único (23505) é caminho normal, não erro", async () => {
    h.chargeRow = cobrancaPendente();
    h.subInsertError = { code: "23505", message: "duplicate key" };
    mp.getOrder.mockResolvedValue(orderPaga());

    const r = await confirmPaymentByOrderId(ORDER);

    expect(r).toMatchObject({ created: false, status: "paid", chargeId: CHARGE_ID });
  });

  it("outro erro de banco no insert NÃO é engolido", async () => {
    h.chargeRow = cobrancaPendente();
    h.subInsertError = { code: "08006", message: "connection failure" };
    mp.getOrder.mockResolvedValue(orderPaga());

    await expect(confirmPaymentByOrderId(ORDER)).rejects.toBeInstanceOf(BillingError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("confirmPaymentByOrderId — as recusas", () => {
  it("cobrança sem user_id não vira assinatura órfã (a coluna é nullable por LGPD)", async () => {
    h.chargeRow = cobrancaPendente({ user_id: null });
    mp.getOrder.mockResolvedValue(orderPaga());

    await expect(confirmPaymentByOrderId(ORDER)).rejects.toMatchObject({
      code: "USER_REQUIRED",
    });
    expect(h.subInserts).toHaveLength(0);
  });

  it("valor pago diferente do cobrado não libera acesso", async () => {
    h.chargeRow = cobrancaPendente();
    mp.getOrder.mockResolvedValue(orderPaga({ amountCents: 1 }));

    await expect(confirmPaymentByOrderId(ORDER)).rejects.toMatchObject({
      code: "AMOUNT_MISMATCH",
    });
    expect(h.subInserts).toHaveLength(0);
  });

  it("valor ausente na resposta não bloqueia — não conferir ≠ conferir e dar errado", async () => {
    h.chargeRow = cobrancaPendente();
    mp.getOrder.mockResolvedValue(orderPaga({ amountCents: null }));

    const r = await confirmPaymentByOrderId(ORDER);
    expect(r.created).toBe(true);
  });

  it("status diferente de 'paid' atualiza a cobrança e não libera nada", async () => {
    h.chargeRow = cobrancaPendente();
    mp.getOrder.mockResolvedValue(orderPaga({ status: "expired", rawStatus: "expired" }));

    const r = await confirmPaymentByOrderId(ORDER);

    expect(r).toMatchObject({ created: false, status: "expired" });
    expect(h.subInserts).toHaveLength(0);
    expect(h.chargeUpdates.at(-1)?.payload).toMatchObject({ status: "expired" });
  });

  it("status desconhecido cai em 'pending' e não libera (falha fechado)", async () => {
    h.chargeRow = cobrancaPendente();
    mp.getOrder.mockResolvedValue(orderPaga({ status: "pending", rawStatus: "sei_la_o_que" }));

    const r = await confirmPaymentByOrderId(ORDER);
    expect(r.created).toBe(false);
    expect(h.subInserts).toHaveLength(0);
  });

  it("notificação de order que não é nossa devolve CHARGE_NOT_FOUND", async () => {
    h.chargeRow = null;
    mp.getOrder.mockResolvedValue(orderPaga({ externalReference: "de-outro-ambiente" }));

    await expect(confirmPaymentByOrderId(ORDER)).rejects.toMatchObject({
      code: "CHARGE_NOT_FOUND",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("getChargeStatus — o polling da página", () => {
  it("filtra por dono: RLS não protege sob service_role, o filtro explícito sim", async () => {
    h.chargeRow = cobrancaPendente({ status: "paid" });
    await getChargeStatus(CHARGE_ID, USER);

    expect(h.chargeSelectEq).toEqual([
      ["id", CHARGE_ID],
      ["user_id", USER],
    ]);
  });

  it("devolve null quando a cobrança é de outra pessoa (vira 404 na rota)", async () => {
    h.chargeRow = null; // filtro por user_id não casa
    expect(await getChargeStatus(CHARGE_ID, "intruso")).toBeNull();
  });

  it("reconcilia com o provedor quando está pendente — é o que salva webhook perdido", async () => {
    h.chargeRow = cobrancaPendente({ provider_order_id: ORDER });
    mp.getOrder.mockResolvedValue(orderPaga());

    const r = await getChargeStatus(CHARGE_ID, USER);

    expect(mp.getOrder).toHaveBeenCalledWith(ORDER);
    expect(r?.status).toBe("paid");
  });

  it("não reconcilia o que já está pago — poupa chamada à API do provedor", async () => {
    h.chargeRow = cobrancaPendente({ status: "paid", provider_order_id: ORDER });

    const r = await getChargeStatus(CHARGE_ID, USER);

    expect(mp.getOrder).not.toHaveBeenCalled();
    expect(r?.status).toBe("paid");
  });

  it("provedor fora do ar devolve o status armazenado em vez de quebrar a tela", async () => {
    h.chargeRow = cobrancaPendente({ provider_order_id: ORDER });
    mp.getOrder.mockRejectedValue(new Error("timeout"));

    const r = await getChargeStatus(CHARGE_ID, USER);
    expect(r?.status).toBe("pending");
  });
});
