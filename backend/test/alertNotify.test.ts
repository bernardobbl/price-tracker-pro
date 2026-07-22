import { describe, it, expect, vi, beforeEach } from "vitest";

// Spies compartilhados (hoisted p/ uso dentro dos vi.mock).
const h = vi.hoisted(() => ({
  getUserById: vi.fn(async (id: string) => ({
    data: { user: { email: `${id}@example.com` } },
    error: null,
  })),
  eqUpdate: vi.fn(async () => ({ error: null })),
  sendEmail: vi.fn(async () => {}),
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

import { evaluateAlertImmediately, __clearEmailCache } from "../src/services/alertService";

const base = {
  userId: "u1",
  productId: "p1",
  productName: "A Light in the Attic",
  thresholdPrice: 50,
  currentPrice: 40,
  currency: "£",
  productUrl: "https://books.toscrape.com/",
};

describe("evaluateAlertImmediately (trilha única + cache)", () => {
  beforeEach(() => {
    __clearEmailCache();
    h.getUserById.mockClear();
    h.sendEmail.mockClear();
  });

  it("busca o email do mesmo usuário só uma vez (fix do N+1)", async () => {
    await evaluateAlertImmediately({ alertId: "a1", ...base });
    await evaluateAlertImmediately({ alertId: "a2", ...base });

    expect(h.getUserById).toHaveBeenCalledTimes(1); // cache evitou a 2ª chamada
    expect(h.sendEmail).toHaveBeenCalledTimes(2);
  });

  it("notifica quando o preço está no/abaixo do alvo", async () => {
    const ok = await evaluateAlertImmediately({ alertId: "a3", ...base, currentPrice: 50 });
    expect(ok).toBe(true);
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("não notifica quando o preço está acima do alvo", async () => {
    const ok = await evaluateAlertImmediately({ alertId: "a4", ...base, currentPrice: 60 });
    expect(ok).toBe(false);
    expect(h.sendEmail).not.toHaveBeenCalled();
  });
});
