import { describe, it, expect, vi, beforeEach } from "vitest";

// Spies compartilhados (hoisted p/ uso dentro dos vi.mock).
const h = vi.hoisted(() => ({
  getUserById: vi.fn(async (id: string) => ({
    data: { user: { email: `${id}@example.com` } },
    error: null,
  })),
  eqUpdate: vi.fn(async () => ({ error: null })),
  // Devolve `true` porque é esse o contrato: `sendPriceAlertEmail` só responde
  // `true` quando o email realmente saiu, e o `notifyAndMark` depende disso para
  // marcar o alerta. O teste de SMTP indisponível está no `alertNoSmtp.test.ts`.
  sendEmail: vi.fn(async () => true),
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

// getSnapshot é a "leitura de preço" do domínio combustível; mockada para não tocar o banco.
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

const base = { userId: "u1", series, thresholdPrice: 5.5, currency: "R$" };

function snapshotWithAvg(avgPrice: number | null) {
  return { date: "2026-07-20", avgPrice, minPrice: avgPrice, maxPrice: avgPrice, sampleSize: 3, quotes: [] };
}

describe("evaluateFuelAlertImmediately (trilha única + cache de email)", () => {
  beforeEach(() => {
    __clearEmailCache();
    h.getUserById.mockClear();
    h.sendEmail.mockClear();
    h.getSnapshot.mockReset();
  });

  it("busca o email do mesmo usuário só uma vez (fix do N+1)", async () => {
    h.getSnapshot.mockResolvedValue(snapshotWithAvg(5.4)); // abaixo do alvo → notifica
    await evaluateFuelAlertImmediately({ alertId: "a1", ...base });
    await evaluateFuelAlertImmediately({ alertId: "a2", ...base });

    expect(h.getUserById).toHaveBeenCalledTimes(1); // cache evitou a 2ª chamada
    expect(h.sendEmail).toHaveBeenCalledTimes(2);
  });

  it("notifica quando a média está no/abaixo do alvo", async () => {
    h.getSnapshot.mockResolvedValue(snapshotWithAvg(5.5)); // limite inclusivo
    const ok = await evaluateFuelAlertImmediately({ alertId: "a3", ...base });
    expect(ok).toBe(true);
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("não notifica quando a média está acima do alvo", async () => {
    h.getSnapshot.mockResolvedValue(snapshotWithAvg(6.0));
    const ok = await evaluateFuelAlertImmediately({ alertId: "a4", ...base });
    expect(ok).toBe(false);
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("não notifica quando não há levantamento (avg nulo)", async () => {
    h.getSnapshot.mockResolvedValue(snapshotWithAvg(null));
    const ok = await evaluateFuelAlertImmediately({ alertId: "a5", ...base });
    expect(ok).toBe(false);
    expect(h.sendEmail).not.toHaveBeenCalled();
  });
});
