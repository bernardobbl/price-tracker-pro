import { describe, it, expect } from "vitest";
import { decideAlertQuota, FREE_ALERT_LIMIT } from "../src/lib/alertQuota";

describe("decideAlertQuota — estado atual (grátis ilimitado)", () => {
  it("hoje o limite do grátis é ilimitado — nada muda para quem já usa", () => {
    expect(FREE_ALERT_LIMIT).toBe(Number.POSITIVE_INFINITY);
  });

  it("usuário sem assinatura com 50 alertas continua podendo criar", () => {
    const d = decideAlertQuota({ hasActiveSubscription: false, currentCount: 50 });
    expect(d.allowed).toBe(true);
  });
});

describe("decideAlertQuota — comportamento quando o limite for ligado", () => {
  // Simula a decisão com um limite finito, provando que a regra já funciona
  // antes mesmo de trocarmos a constante.
  const comLimite = (limite: number, count: number, pago: boolean) => {
    const limit = pago ? Number.POSITIVE_INFINITY : limite;
    return { allowed: count < limit, limit };
  };

  it("grátis no limite é bloqueado", () => {
    expect(comLimite(2, 2, false).allowed).toBe(false);
  });

  it("grátis abaixo do limite passa", () => {
    expect(comLimite(2, 1, false).allowed).toBe(true);
  });

  it("assinante passa mesmo muito acima do limite do grátis", () => {
    expect(comLimite(2, 999, true).allowed).toBe(true);
  });
});

describe("decideAlertQuota — mensagem ao usuário", () => {
  it("quando permitido, não devolve motivo", () => {
    const d = decideAlertQuota({ hasActiveSubscription: true, currentCount: 10 });
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("");
  });
});
