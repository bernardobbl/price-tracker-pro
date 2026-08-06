import { describe, it, expect } from "vitest";
import { decideAlertQuota, FREE_ALERT_LIMIT, PAID_ALERT_LIMIT } from "../src/lib/alertQuota";

/**
 * O limite do plano gratuito passou de `Infinity` para **1** em 05/ago/2026.
 *
 * O número tem justificativa de produto, não de engenharia: o motorista de carro
 * flex quer comparar gasolina e etanol, o que são dois alertas. Um limite de 2
 * cobriria exatamente esse caso e ninguém encostaria nele — o plano pago
 * existiria no papel. Com 1, a fronteira cai onde o motivo para assinar aparece
 * sozinho. Se este teste falhar porque alguém mudou a constante, mude o
 * raciocínio junto (ele está no `alertQuota.ts`), não só o número.
 */

describe("decideAlertQuota — o limite do plano gratuito", () => {
  it("o grátis acompanha 1 série", () => {
    expect(FREE_ALERT_LIMIT).toBe(1);
  });

  it("o pago é ilimitado — é o que a landing promete", () => {
    expect(PAID_ALERT_LIMIT).toBe(Number.POSITIVE_INFINITY);
  });

  it("grátis sem nenhum alerta pode criar o primeiro", () => {
    const d = decideAlertQuota({ hasActiveSubscription: false, currentCount: 0 });
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("");
  });

  it("grátis com 1 alerta é barrado no segundo", () => {
    const d = decideAlertQuota({ hasActiveSubscription: false, currentCount: 1 });
    expect(d.allowed).toBe(false);
    expect(d.limit).toBe(1);
  });

  it("assinante passa muito acima do limite do grátis", () => {
    const d = decideAlertQuota({ hasActiveSubscription: true, currentCount: 999 });
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("");
  });
});

describe("decideAlertQuota — a mensagem da recusa", () => {
  const recusa = decideAlertQuota({ hasActiveSubscription: false, currentCount: 1 });

  it("usa singular quando o limite é 1", () => {
    // "1 séries" numa tela de produto é o tipo de detalhe que faz parecer
    // inacabado — e esta mensagem aparece justamente no momento de decidir pagar.
    expect(recusa.reason).toContain("1 série");
    expect(recusa.reason).not.toContain("1 séries");
  });

  it("diz o que a pessoa AINDA PODE fazer, não só o que não pode", () => {
    // Recusa que só nega vira sensação de armadilha. Trocar a série do alerta
    // existente continua sendo grátis, e a mensagem precisa dizer isso.
    expect(recusa.reason).toContain("trocar a série");
  });

  it("aponta o caminho pago sem prometer o que não entregamos", () => {
    expect(recusa.reason).toContain("Premium");
  });
});
