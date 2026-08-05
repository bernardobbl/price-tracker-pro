import { describe, it, expect } from "vitest";
import {
  addCalendarMonths,
  computeExpiresAt,
  computeProRataRefundCents,
  isWithinPeriod,
  PLAN_PRICE_CENTS,
} from "../src/lib/subscriptionPeriod";

/** Helper: monta uma data UTC legível nos testes. */
const utc = (iso: string) => new Date(iso);
/** Helper: formata como dd/mm/aaaa para as asserções ficarem lidas em português. */
const br = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

describe("addCalendarMonths — mês de calendário com clamp", () => {
  it("31/jan + 1 mês = 28/fev (fevereiro não tem dia 31)", () => {
    expect(br(addCalendarMonths(utc("2026-01-31T12:00:00Z"), 1))).toBe("28/02/2026");
  });

  it("31/jan + 1 mês = 29/fev em ano bissexto", () => {
    expect(br(addCalendarMonths(utc("2028-01-31T12:00:00Z"), 1))).toBe("29/02/2028");
  });

  it("31/mar + 1 mês = 30/abr", () => {
    expect(br(addCalendarMonths(utc("2026-03-31T12:00:00Z"), 1))).toBe("30/04/2026");
  });

  it("29/fev/2028 + 12 meses = 28/fev/2029 (2029 não é bissexto)", () => {
    expect(br(addCalendarMonths(utc("2028-02-29T12:00:00Z"), 12))).toBe("28/02/2029");
  });

  it("14/08 + 1 mês = 14/09 — o caso do dia normal", () => {
    expect(br(addCalendarMonths(utc("2026-08-14T12:00:00Z"), 1))).toBe("14/09/2026");
  });

  it("preserva o horário: a vigência acaba na mesma hora, não à meia-noite", () => {
    const d = addCalendarMonths(utc("2026-08-14T15:30:45.123Z"), 1);
    expect(d.toISOString()).toBe("2026-09-14T15:30:45.123Z");
  });

  it("atravessa a virada de ano", () => {
    expect(br(addCalendarMonths(utc("2026-12-15T00:00:00Z"), 1))).toBe("15/01/2027");
  });

  it("NÃO é 30 dias fixos — 12 mensais fecham 365 dias, igual ao anual", () => {
    let cursor = utc("2026-01-01T00:00:00Z");
    for (let i = 0; i < 12; i += 1) cursor = addCalendarMonths(cursor, 1);
    expect(cursor.toISOString()).toBe("2027-01-01T00:00:00.000Z");

    const anual = addCalendarMonths(utc("2026-01-01T00:00:00Z"), 12);
    expect(cursor.getTime()).toBe(anual.getTime());
  });
});

describe("computeExpiresAt — primeira compra", () => {
  it("mensal comprado em 14/08 vence em 14/09", () => {
    const expires = computeExpiresAt({ plan: "mensal", now: utc("2026-08-14T10:00:00Z") });
    expect(br(expires)).toBe("14/09/2026");
  });

  it("anual comprado em 04/08/2026 vence em 04/08/2027", () => {
    const expires = computeExpiresAt({ plan: "anual", now: utc("2026-08-04T10:00:00Z") });
    expect(br(expires)).toBe("04/08/2027");
  });
});

describe("computeExpiresAt — renovação", () => {
  it("renovar com 10 dias sobrando SOMA ao saldo (não perde os 10 dias)", () => {
    const now = utc("2026-08-14T10:00:00Z");
    const currentExpiresAt = utc("2026-08-24T10:00:00Z"); // 10 dias à frente

    const expires = computeExpiresAt({ plan: "mensal", now, currentExpiresAt });

    // 24/08 + 1 mês = 24/09 — e não 14/09, que descartaria os 10 dias pagos.
    expect(br(expires)).toBe("24/09/2026");

    const diasDeAcesso = Math.round((expires.getTime() - now.getTime()) / 86_400_000);
    expect(diasDeAcesso).toBe(41); // 10 que sobravam + 31 do mês somado
  });

  it("renovar 5 dias DEPOIS de vencido conta a partir de agora (sem crédito retroativo)", () => {
    const now = utc("2026-08-14T10:00:00Z");
    const currentExpiresAt = utc("2026-08-09T10:00:00Z"); // venceu há 5 dias

    const expires = computeExpiresAt({ plan: "mensal", now, currentExpiresAt });
    expect(br(expires)).toBe("14/09/2026");
  });

  it("renovar anual sobre anual ativo empilha 12 meses no vencimento", () => {
    const expires = computeExpiresAt({
      plan: "anual",
      now: utc("2026-08-14T10:00:00Z"),
      currentExpiresAt: utc("2027-01-10T10:00:00Z"),
    });
    expect(br(expires)).toBe("10/01/2028");
  });
});

describe("isWithinPeriod — corte estrito", () => {
  const expiresAt = utc("2026-09-14T10:00:00Z");

  it("1 segundo ANTES do vencimento: acesso liberado", () => {
    expect(isWithinPeriod(utc("2026-09-14T09:59:59Z"), expiresAt)).toBe(true);
  });

  it("no instante EXATO do vencimento: bloqueado", () => {
    expect(isWithinPeriod(utc("2026-09-14T10:00:00Z"), expiresAt)).toBe(false);
  });

  it("1 segundo DEPOIS do vencimento: bloqueado", () => {
    expect(isWithinPeriod(utc("2026-09-14T10:00:01Z"), expiresAt)).toBe(false);
  });

  it("estorno zera a vigência e o acesso cai na hora", () => {
    const agora = utc("2026-08-20T10:00:00Z");
    expect(isWithinPeriod(agora, agora)).toBe(false);
  });
});

describe("computeProRataRefundCents — o que a política promete", () => {
  it("anual cancelado no 4º mês devolve 8/12 = R$ 39,93", () => {
    const refund = computeProRataRefundCents({
      plan: "anual",
      amountPaidCents: PLAN_PRICE_CENTS.anual,
      now: utc("2026-12-04T10:00:00Z"), // 4 meses depois da compra
      expiresAt: utc("2027-08-04T10:00:00Z"),
    });
    expect(refund).toBe(3993); // R$ 39,93 — o exemplo publicado em reembolso.html
  });

  it("cancelado com menos de 1 mês inteiro restante não devolve nada", () => {
    const refund = computeProRataRefundCents({
      plan: "anual",
      amountPaidCents: PLAN_PRICE_CENTS.anual,
      now: utc("2027-07-20T10:00:00Z"),
      expiresAt: utc("2027-08-04T10:00:00Z"),
    });
    expect(refund).toBe(0);
  });

  it("nunca devolve mais do que foi pago", () => {
    const refund = computeProRataRefundCents({
      plan: "anual",
      amountPaidCents: PLAN_PRICE_CENTS.anual,
      now: utc("2026-08-04T10:00:00Z"),
      expiresAt: utc("2027-08-04T10:00:00Z"),
    });
    expect(refund).toBeLessThanOrEqual(PLAN_PRICE_CENTS.anual);
  });

  it("já vencido devolve zero, nunca negativo", () => {
    const refund = computeProRataRefundCents({
      plan: "mensal",
      amountPaidCents: PLAN_PRICE_CENTS.mensal,
      now: utc("2026-10-01T10:00:00Z"),
      expiresAt: utc("2026-09-14T10:00:00Z"),
    });
    expect(refund).toBe(0);
  });
});
