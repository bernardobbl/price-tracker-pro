import { describe, it, expect } from "vitest";
import {
  daysUntil,
  montarConteudoVencimento,
  selectSubscriptionsToWarn,
  NOTICE_WINDOW_DAYS,
  type SubscriptionForNotice,
} from "../src/lib/expiryNotice";

const DAY = 86_400_000;
const now = new Date("2026-08-04T10:00:00Z");
const emDias = (d: number) => new Date(now.getTime() + d * DAY);

const sub = (over: Partial<SubscriptionForNotice> = {}): SubscriptionForNotice => ({
  id: "s1",
  userId: "u1",
  email: "a@exemplo.com",
  plan: "mensal",
  expiresAt: emDias(3),
  warnedAt: null,
  ...over,
});

describe("selectSubscriptionsToWarn — janela", () => {
  it("a janela é de 8 dias, não 7 — o job é semanal e 7 deixaria escapar pelo vão", () => {
    expect(NOTICE_WINDOW_DAYS).toBe(8);
  });

  it("avisa quem vence dentro da janela", () => {
    const r = selectSubscriptionsToWarn({ subscriptions: [sub({ expiresAt: emDias(5) })], now });
    expect(r).toHaveLength(1);
  });

  it("avisa quem vence em 7,5 dias — o caso que uma janela de 7 perderia", () => {
    const r = selectSubscriptionsToWarn({ subscriptions: [sub({ expiresAt: emDias(7.5) })], now });
    expect(r).toHaveLength(1);
  });

  it("não avisa quem vence depois da janela", () => {
    const r = selectSubscriptionsToWarn({ subscriptions: [sub({ expiresAt: emDias(20) })], now });
    expect(r).toHaveLength(0);
  });

  it("não avisa quem já venceu — o aviso perdeu a função", () => {
    const r = selectSubscriptionsToWarn({ subscriptions: [sub({ expiresAt: emDias(-1) })], now });
    expect(r).toHaveLength(0);
  });
});

describe("selectSubscriptionsToWarn — não repetir", () => {
  it("não avisa duas vezes a mesma assinatura", () => {
    const r = selectSubscriptionsToWarn({
      subscriptions: [sub({ warnedAt: new Date("2026-08-01T10:00:00Z") })],
      now,
    });
    expect(r).toHaveLength(0);
  });
});

describe("selectSubscriptionsToWarn — renovação", () => {
  it("quem renovou NÃO recebe aviso pela linha antiga", () => {
    // Renovação cria linha nova; a antiga continua 'active' com vencimento anterior.
    // Sem o filtro de "maior vigência por usuário", a antiga dispararia um aviso
    // de vencimento para alguém que acabou de pagar.
    const antiga = sub({ id: "velha", expiresAt: emDias(2) });
    const nova = sub({ id: "nova", expiresAt: emDias(33) });

    const r = selectSubscriptionsToWarn({ subscriptions: [antiga, nova], now });
    expect(r).toHaveLength(0);
  });

  it("usuários diferentes são avaliados separadamente", () => {
    const a = sub({ id: "a", userId: "u1", expiresAt: emDias(3) });
    const b = sub({ id: "b", userId: "u2", expiresAt: emDias(40) });

    const r = selectSubscriptionsToWarn({ subscriptions: [a, b], now });
    expect(r.map((x) => x.id)).toEqual(["a"]);
  });

  it("ordena do que vence mais cedo para o mais tarde", () => {
    const a = sub({ id: "a", userId: "u1", expiresAt: emDias(6) });
    const b = sub({ id: "b", userId: "u2", expiresAt: emDias(2) });

    const r = selectSubscriptionsToWarn({ subscriptions: [a, b], now });
    expect(r.map((x) => x.id)).toEqual(["b", "a"]);
  });
});

describe("daysUntil", () => {
  it("conta dias inteiros e nunca fica negativo", () => {
    expect(daysUntil(now, emDias(7))).toBe(7);
    expect(daysUntil(now, emDias(0.5))).toBe(0);
    expect(daysUntil(now, emDias(-5))).toBe(0);
  });
});

describe("montarConteudoVencimento", () => {
  it("diz quantos dias faltam e a data", () => {
    const { subject, text } = montarConteudoVencimento({
      plan: "mensal",
      expiresAt: emDias(7),
      now,
      appUrl: "https://exemplo.com",
    });
    expect(subject).toContain("em 7 dias");
    expect(subject).toContain("11/08/2026");
    expect(text).toContain("mensal");
  });

  it("usa 'amanhã' e 'hoje' em vez de '1 dias' e '0 dias'", () => {
    expect(montarConteudoVencimento({ plan: "anual", expiresAt: emDias(1), now }).subject)
      .toContain("amanhã");
    expect(montarConteudoVencimento({ plan: "anual", expiresAt: emDias(0.2), now }).subject)
      .toContain("hoje");
  });

  it("deixa claro que NÃO haverá cobrança automática", () => {
    const { text } = montarConteudoVencimento({ plan: "mensal", expiresAt: emDias(5), now });
    expect(text).toContain("Não existe cobrança automática");
  });

  it("tranquiliza: nada é apagado se não renovar", () => {
    const { text } = montarConteudoVencimento({ plan: "anual", expiresAt: emDias(5), now });
    expect(text).toContain("Nada é apagado");
  });

  it("inclui o link de renovação quando há FRONTEND_URL", () => {
    const { text } = montarConteudoVencimento({
      plan: "mensal",
      expiresAt: emDias(5),
      now,
      appUrl: "https://exemplo.com/",
    });
    expect(text).toContain("https://exemplo.com/premium"); // sem barra dupla
  });

  it("sai sem link — e sem quebrar — quando não há FRONTEND_URL", () => {
    const { text } = montarConteudoVencimento({ plan: "mensal", expiresAt: emDias(5), now });
    expect(text).not.toContain("http");
    expect(text).toContain("Price Tracker Pro");
  });
});
