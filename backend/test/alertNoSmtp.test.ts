import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regressão do bug mais caro descoberto até aqui: **alerta marcado como avisado
 * sem que nenhum email tivesse saído.**
 *
 * O que acontecia: o GitHub Actions rodava sem os secrets de SMTP, o
 * `sendPriceAlertEmail` caía num `return` mudo, e o `notifyAndMark` gravava
 * `triggered: true` assim mesmo. Como `triggered` só volta a `false` quando o
 * preço sobe acima do alvo, o alerta ficava queimado — a pessoa nunca era
 * avisada, e o log dizia "notificado".
 *
 * A regra que este arquivo tranca: **sem envio confirmado, não marca.**
 */

const h = vi.hoisted(() => ({
  getUserById: vi.fn(async (id: string) => ({
    data: { user: { email: `${id}@example.com` } },
    error: null,
  })),
  eqUpdate: vi.fn(async () => ({ error: null })),
  // `false` = não havia transporte SMTP configurado.
  sendEmail: vi.fn(async () => false),
  getSnapshot: vi.fn(),
}));

vi.mock("../src/config/supabaseClient", () => ({
  supabase: {
    auth: { admin: { getUserById: h.getUserById } },
    from: () => ({ update: () => ({ eq: h.eqUpdate }) }),
  },
}));

vi.mock("../src/services/emailService", () => ({
  sendPriceAlertEmail: h.sendEmail,
}));

vi.mock("../src/services/fuelQueryService", () => ({
  getSnapshot: h.getSnapshot,
}));

import { evaluateFuelAlertImmediately } from "../src/services/fuelAlertService";
import { __clearEmailCache } from "../src/services/userEmailService";

const series = {
  product: "GASOLINA",
  state: "SP",
  municipality: "SAO PAULO",
  brand: null,
  label: "Gasolina · São Paulo/SP",
};

describe("alerta com SMTP indisponível", () => {
  beforeEach(() => {
    __clearEmailCache();
    h.getUserById.mockClear();
    h.eqUpdate.mockClear();
    h.sendEmail.mockClear();
    h.getSnapshot.mockReset();
  });

  it("não marca o alerta como disparado quando o email não saiu", async () => {
    h.getSnapshot.mockResolvedValue({
      date: "2026-07-20",
      avgPrice: 5.4, // abaixo do alvo → tentaria notificar
      minPrice: 5.4,
      maxPrice: 5.4,
      sampleSize: 3,
      quotes: [],
    });

    const ok = await evaluateFuelAlertImmediately({
      alertId: "a1",
      userId: "u1",
      series,
      thresholdPrice: 5.5,
      currency: "R$",
    });

    // Tentou enviar…
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    // …não conseguiu, então NÃO reporta sucesso…
    expect(ok).toBe(false);
    // …e acima de tudo: não gravou `triggered: true` no banco.
    expect(h.eqUpdate).not.toHaveBeenCalled();
  });

  it("segue tentando nas avaliações seguintes, porque nada foi marcado", async () => {
    h.getSnapshot.mockResolvedValue({
      date: "2026-07-20",
      avgPrice: 5.4,
      minPrice: 5.4,
      maxPrice: 5.4,
      sampleSize: 3,
      quotes: [],
    });

    const base = { userId: "u1", series, thresholdPrice: 5.5, currency: "R$" };
    await evaluateFuelAlertImmediately({ alertId: "a1", ...base });
    await evaluateFuelAlertImmediately({ alertId: "a1", ...base });

    expect(h.sendEmail).toHaveBeenCalledTimes(2);
    expect(h.eqUpdate).not.toHaveBeenCalled();
  });
});
