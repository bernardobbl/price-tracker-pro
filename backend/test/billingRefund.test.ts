/**
 * Estorno e reembolso proporcional — a parte do sistema que tira dinheiro de casa.
 *
 * O que se testa aqui é a **decisão**: qual regra da Política de Reembolso se
 * aplica, quanto ela manda devolver, e o que acontece no banco depois. Provedor
 * e Supabase são falsos.
 *
 * Os dois casos que mais importam não são os de sucesso:
 *
 *  - **valor confirmado que não bate** com o calculado tem de recusar ANTES de
 *    chamar o provedor (senão a conferência não serve para nada);
 *  - **provedor recusando** não pode deixar rastro no banco (acesso cortado sem
 *    dinheiro devolvido é o pior resultado possível).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  chargeRow: null as Record<string, unknown> | null,
  subRow: null as Record<string, unknown> | null,
  /** Erro devolvido pelo update em subscriptions (para o caminho de falha). */
  subUpdateError: null as { message: string } | null,

  chargeUpdates: [] as Record<string, unknown>[],
  subUpdates: [] as Record<string, unknown>[],

  refundOrder: vi.fn(async () => ({
    status: "processed",
    statusDetail: "refunded",
    refundedCents: null as number | null,
    refundId: "REF01",
  })),
  getOrder: vi.fn(async () => ({
    orderId: "ORD01",
    externalReference: "charge-1",
    status: "paid" as const,
    rawStatus: "processed",
    amountCents: 5990,
    paymentTransactionId: "PAY01",
  })),
}));

vi.mock("../src/config/supabaseClient", () => {
  function makeBuilder(table: string) {
    let op = "select";
    let payload: Record<string, unknown> = {};

    const result = () => {
      if (op === "update") {
        if (table === "subscriptions") {
          h.subUpdates.push(payload);
          return { data: h.subUpdateError ? null : [{ id: "sub-1" }], error: h.subUpdateError };
        }
        h.chargeUpdates.push(payload);
        return { data: null, error: null };
      }
      return {
        data: table === "billing_charges" ? h.chargeRow : h.subRow,
        error: null,
      };
    };

    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => result(),
      update: (p: Record<string, unknown>) => {
        op = "update";
        payload = p;
        return builder;
      },
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return builder;
  }

  return { supabase: { from: (t: string) => makeBuilder(t) } };
});

vi.mock("../src/services/mercadoPagoClient", () => ({
  refundOrder: h.refundOrder,
  getOrder: h.getOrder,
  createPixOrder: vi.fn(),
  normalizeOrderStatus: (s: string) => s,
}));

import { previewRefund, refundCharge, BillingError } from "../src/services/billingService";
import { PLAN_PRICE_CENTS } from "../src/lib/subscriptionPeriod";

const AGORA = new Date("2026-08-05T12:00:00Z");

/** Cobrança paga há N dias, com a vigência coerente com o plano. */
function cobranca(plan: "mensal" | "anual", diasAtras: number, expiresAt: string) {
  h.chargeRow = {
    id: "charge-1",
    plan,
    amount_cents: PLAN_PRICE_CENTS[plan],
    status: "paid",
    paid_at: new Date(AGORA.getTime() - diasAtras * 86_400_000).toISOString(),
    provider_order_id: "ORD01",
  };
  h.subRow = { id: "sub-1", expires_at: expiresAt };
}

beforeEach(() => {
  h.chargeRow = null;
  h.subRow = null;
  h.subUpdateError = null;
  h.chargeUpdates = [];
  h.subUpdates = [];
  h.refundOrder.mockClear();
  h.getOrder.mockClear();
});

describe("previewRefund — qual regra da política se aplica", () => {
  it("dentro de 7 dias devolve tudo, mesmo no mensal e mesmo tendo usado", async () => {
    cobranca("mensal", 3, "2026-09-02T12:00:00Z");
    const p = await previewRefund("charge-1", AGORA);

    expect(p.rule).toBe("cdc-7-dias");
    expect(p.refundCents).toBe(PLAN_PRICE_CENTS.mensal);
    expect(p.total).toBe(true);
  });

  it("no 7º dia ainda é integral — o prazo do CDC é inclusivo", async () => {
    cobranca("anual", 7, "2027-08-02T12:00:00Z");
    const p = await previewRefund("charge-1", AGORA);
    expect(p.rule).toBe("cdc-7-dias");
    expect(p.refundCents).toBe(PLAN_PRICE_CENTS.anual);
  });

  it("mensal fora dos 7 dias não devolve nada, como a política diz", async () => {
    cobranca("mensal", 20, "2026-09-02T12:00:00Z");
    const p = await previewRefund("charge-1", AGORA);

    expect(p.rule).toBe("sem-reembolso");
    expect(p.refundCents).toBe(0);
  });

  it("anual fora dos 7 dias devolve os meses inteiros não usados (o exemplo publicado)", async () => {
    // Comprado em 04/ago/2026, estamos em 04/dez/2026 → 8 meses inteiros restantes.
    const agora = new Date("2026-12-04T10:00:00Z");
    h.chargeRow = {
      id: "charge-1",
      plan: "anual",
      amount_cents: PLAN_PRICE_CENTS.anual,
      status: "paid",
      paid_at: "2026-08-04T10:00:00Z",
      provider_order_id: "ORD01",
    };
    h.subRow = { id: "sub-1", expires_at: "2027-08-04T10:00:00Z" };

    const p = await previewRefund("charge-1", agora);

    expect(p.rule).toBe("prorata-anual");
    expect(p.refundCents).toBe(3993); // R$ 39,93 — o número impresso em reembolso.html
    expect(p.total).toBe(false);
  });

  it("sem data de pagamento cai no integral — na dúvida, o consumidor não perde o prazo", async () => {
    h.chargeRow = {
      id: "charge-1",
      plan: "anual",
      amount_cents: PLAN_PRICE_CENTS.anual,
      status: "paid",
      paid_at: null,
      provider_order_id: "ORD01",
    };
    h.subRow = { id: "sub-1", expires_at: "2027-08-04T10:00:00Z" };

    const p = await previewRefund("charge-1", AGORA);
    expect(p.rule).toBe("cdc-7-dias");
    expect(p.refundCents).toBe(PLAN_PRICE_CENTS.anual);
  });

  it("recusa cobrança já estornada", async () => {
    h.chargeRow = { id: "charge-1", plan: "anual", amount_cents: 5990, status: "refunded", paid_at: null };
    await expect(previewRefund("charge-1", AGORA)).rejects.toMatchObject({
      code: "ALREADY_PROCESSED",
    });
  });

  it("recusa cobrança que nunca foi paga", async () => {
    h.chargeRow = { id: "charge-1", plan: "anual", amount_cents: 5990, status: "pending", paid_at: null };
    await expect(previewRefund("charge-1", AGORA)).rejects.toBeInstanceOf(BillingError);
  });

  it("recusa cobrança inexistente", async () => {
    h.chargeRow = null;
    await expect(previewRefund("charge-1", AGORA)).rejects.toMatchObject({
      code: "CHARGE_NOT_FOUND",
    });
  });
});

describe("refundCharge — execução", () => {
  it("estorno total manda corpo sem valor e encerra o acesso", async () => {
    cobranca("anual", 2, "2027-08-02T12:00:00Z");

    const out = await refundCharge({
      chargeId: "charge-1",
      expectedCents: PLAN_PRICE_CENTS.anual,
      actor: "operador@exemplo.com",
      now: AGORA,
    });

    // `amountCents: undefined` é o que faz o cliente mandar corpo vazio — que é
    // como a API do provedor distingue total de parcial.
    expect(h.refundOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "ORD01", amountCents: undefined })
    );
    expect(out.total).toBe(true);
    expect(out.refundedCents).toBe(PLAN_PRICE_CENTS.anual);

    expect(h.chargeUpdates).toEqual([{ status: "refunded" }]);
    expect(h.subUpdates).toEqual([
      { status: "refunded", expires_at: AGORA.toISOString() },
    ]);
  });

  it("estorno parcial manda valor e o id da transação", async () => {
    const agora = new Date("2026-12-04T10:00:00Z");
    h.chargeRow = {
      id: "charge-1",
      plan: "anual",
      amount_cents: PLAN_PRICE_CENTS.anual,
      status: "paid",
      paid_at: "2026-08-04T10:00:00Z",
      provider_order_id: "ORD01",
    };
    h.subRow = { id: "sub-1", expires_at: "2027-08-04T10:00:00Z" };

    await refundCharge({
      chargeId: "charge-1",
      expectedCents: 3993,
      actor: "operador@exemplo.com",
      now: agora,
    });

    expect(h.refundOrder).toHaveBeenCalledWith({
      orderId: "ORD01",
      amountCents: 3993,
      paymentTransactionId: "PAY01",
    });
  });

  it("valor confirmado divergente recusa ANTES de chamar o provedor", async () => {
    cobranca("anual", 2, "2027-08-02T12:00:00Z");

    await expect(
      refundCharge({
        chargeId: "charge-1",
        expectedCents: 1, // qualquer coisa diferente do calculado
        actor: "operador@exemplo.com",
        now: AGORA,
      })
    ).rejects.toMatchObject({ code: "AMOUNT_MISMATCH" });

    expect(h.refundOrder).not.toHaveBeenCalled();
    expect(h.chargeUpdates).toEqual([]);
    expect(h.subUpdates).toEqual([]);
  });

  it("não estorna quando a política manda devolver zero", async () => {
    cobranca("mensal", 20, "2026-09-02T12:00:00Z");

    await expect(
      refundCharge({
        chargeId: "charge-1",
        expectedCents: 0,
        actor: "operador@exemplo.com",
        now: AGORA,
      })
    ).rejects.toMatchObject({ code: "AMOUNT_MISMATCH" });

    expect(h.refundOrder).not.toHaveBeenCalled();
  });

  it("provedor recusando não deixa rastro no banco", async () => {
    cobranca("anual", 2, "2027-08-02T12:00:00Z");
    h.refundOrder.mockRejectedValueOnce(new Error("saldo insuficiente"));

    await expect(
      refundCharge({
        chargeId: "charge-1",
        expectedCents: PLAN_PRICE_CENTS.anual,
        actor: "operador@exemplo.com",
        now: AGORA,
      })
    ).rejects.toMatchObject({ code: "PROVIDER_FAILED" });

    // O acesso continua ativo, que é o certo: ninguém perdeu acesso sem
    // receber o dinheiro de volta.
    expect(h.chargeUpdates).toEqual([]);
    expect(h.subUpdates).toEqual([]);
  });

  it("a mensagem do provedor não vaza para quem chamou", async () => {
    cobranca("anual", 2, "2027-08-02T12:00:00Z");
    h.refundOrder.mockRejectedValueOnce(new Error("HTTP 400: collector_account_without_balance"));

    await expect(
      refundCharge({
        chargeId: "charge-1",
        expectedCents: PLAN_PRICE_CENTS.anual,
        actor: "operador@exemplo.com",
        now: AGORA,
      })
    ).rejects.toMatchObject({ message: "O provedor recusou o estorno. Nada foi alterado." });
  });
});
