import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `evaluateAllFuelAlerts` — a varredura semanal — **não tinha teste nenhum**.
 *
 * É a função que decide quem recebe e-mail toda semana, e a única cobertura que
 * existia era a do `evaluateFuelAlertImmediately`, que trata um alerta só. O
 * caminho de produção, com vários donos e vários planos, nunca tinha sido
 * exercitado — e foi exatamente ali que o vazamento morava: alerta criado como
 * assinante continuava disparando depois do vencimento.
 *
 * Este arquivo cobre a varredura de verdade, com o banco e o SMTP fingidos.
 */

interface AlertRow {
  id: string;
  user_id: string;
  created_at: string | null;
  threshold_price: number;
  currency: string | null;
  triggered: boolean;
  tracked_series: {
    product: string;
    state: string;
    municipality: string;
    brand: string | null;
    label: string;
  } | null;
}

const h = vi.hoisted(() => ({
  alertRows: [] as unknown[],
  /** user_ids devolvidos pela consulta de assinaturas ativas. */
  assinantes: [] as string[],
  getUserById: vi.fn(async (id: string) => ({
    data: { user: { email: `${id}@example.com` } },
    error: null,
  })),
  sendEmail: vi.fn(async () => true),
  getSnapshot: vi.fn(),
  updates: [] as { table: string; patch: unknown; id: string }[],
}));

vi.mock("../src/config/supabaseClient", () => {
  // Construtor mínimo que imita o encadeamento do supabase-js usado pelo
  // serviço: `.select().eq()` para alertas, `.select().in().eq().gt()` para
  // assinaturas, e `.update().eq()` para marcar o alerta.
  function from(table: string) {
    const builder = {
      _patch: null as unknown,
      select() {
        return this;
      },
      in() {
        return this;
      },
      gt() {
        // Fim da cadeia de assinaturas.
        return Promise.resolve({
          data: h.assinantes.map((user_id) => ({ user_id })),
          error: null,
        });
      },
      update(patch: unknown) {
        this._patch = patch;
        return this;
      },
      eq(_col: string, value: string) {
        if (this._patch !== null) {
          h.updates.push({ table, patch: this._patch, id: value });
          return Promise.resolve({ error: null });
        }
        if (table === "alerts") {
          // `.select(...).eq("enabled", true)` — fim da cadeia de alertas.
          return Promise.resolve({ data: h.alertRows, error: null });
        }
        // `subscriptions`: ainda falta o `.gt(...)`.
        return this;
      },
    };
    return builder;
  }

  return {
    supabase: { auth: { admin: { getUserById: h.getUserById } }, from },
  };
});

vi.mock("../src/services/emailService", () => ({ sendPriceAlertEmail: h.sendEmail }));
vi.mock("../src/services/fuelQueryService", () => ({ getSnapshot: h.getSnapshot }));

import { evaluateAllFuelAlerts } from "../src/services/fuelAlertService";
import { __clearEmailCache } from "../src/services/userEmailService";

const serie = {
  product: "GASOLINA",
  state: "SP",
  municipality: "SAO PAULO",
  brand: null,
  label: "Gasolina · São Paulo/SP",
};

function linha(id: string, user_id: string, created_at: string): AlertRow {
  return {
    id,
    user_id,
    created_at,
    // Alvo bem acima do preço do snapshot → todo alerta avaliado notifica.
    threshold_price: 9,
    currency: "R$",
    triggered: false,
    tracked_series: serie,
  };
}

/** Quais alertIds receberam e-mail nesta rodada (na ordem em que saíram). */
function marcados(): string[] {
  return h.updates.filter((u) => u.table === "alerts").map((u) => u.id);
}

beforeEach(() => {
  __clearEmailCache();
  h.alertRows = [];
  h.assinantes = [];
  h.updates = [];
  h.getUserById.mockClear();
  h.sendEmail.mockClear();
  h.getSnapshot.mockReset();
  h.getSnapshot.mockResolvedValue({
    date: "2026-08-03",
    avgPrice: 5.4,
    minPrice: 5.2,
    maxPrice: 5.6,
    sampleSize: 12,
    quotes: [],
  });
});

describe("varredura semanal — assinante", () => {
  it("dispara todos os alertas de quem tem plano ativo", async () => {
    h.alertRows = [
      linha("a1", "pago", "2026-01-01T00:00:00Z"),
      linha("a2", "pago", "2026-02-01T00:00:00Z"),
      linha("a3", "pago", "2026-03-01T00:00:00Z"),
    ];
    h.assinantes = ["pago"];

    const r = await evaluateAllFuelAlerts();

    expect(r.notified).toBe(3);
    expect(r.skippedByQuota).toBe(0);
    expect(h.sendEmail).toHaveBeenCalledTimes(3);
  });
});

describe("varredura semanal — a regressão do vazamento", () => {
  it("assinatura vencida para de disparar os alertas além da cota", async () => {
    // O cenário exato que passava despercebido: três alertas criados enquanto a
    // pessoa era assinante, assinatura vencida, e nenhum sinal de que algo
    // estava errado — só e-mail saindo de graça toda semana.
    h.alertRows = [
      linha("a1", "u1", "2026-01-01T00:00:00Z"),
      linha("a2", "u1", "2026-02-01T00:00:00Z"),
      linha("a3", "u1", "2026-03-01T00:00:00Z"),
    ];
    h.assinantes = []; // ninguém pagou

    const r = await evaluateAllFuelAlerts();

    expect(r.notified).toBe(1);
    expect(r.skippedByQuota).toBe(2);
    // E o que sobrou é o mais antigo, não um qualquer.
    expect(marcados()).toEqual(["a1"]);
  });

  it("não toca nos alertas dormentes — nem para marcar, nem para apagar", async () => {
    h.alertRows = [
      linha("a1", "u1", "2026-01-01T00:00:00Z"),
      linha("a2", "u1", "2026-02-01T00:00:00Z"),
    ];
    h.assinantes = [];

    await evaluateAllFuelAlerts();

    expect(marcados()).not.toContain("a2");
    expect(h.updates.every((u) => u.id !== "a2")).toBe(true);
  });
});

describe("varredura semanal — planos misturados", () => {
  it("a cota é por pessoa: o gratuito é cortado e o assinante ao lado não", async () => {
    h.alertRows = [
      linha("g1", "gratuito", "2026-01-01T00:00:00Z"),
      linha("g2", "gratuito", "2026-02-01T00:00:00Z"),
      linha("p1", "assinante", "2026-01-01T00:00:00Z"),
      linha("p2", "assinante", "2026-02-01T00:00:00Z"),
    ];
    h.assinantes = ["assinante"];

    const r = await evaluateAllFuelAlerts();

    expect(marcados().sort()).toEqual(["g1", "p1", "p2"]);
    expect(r.skippedByQuota).toBe(1);
  });
});

describe("varredura semanal — o que a correção NÃO pode ter quebrado", () => {
  it("gratuito com um alerta só continua sendo avisado normalmente", async () => {
    // O plano gratuito acompanha 1 série, e isso é uma promessa da landing.
    // A correção não pode ter transformado "cota apertada" em "grátis não
    // recebe nada".
    h.alertRows = [linha("a1", "u1", "2026-01-01T00:00:00Z")];
    h.assinantes = [];

    const r = await evaluateAllFuelAlerts();

    expect(r.notified).toBe(1);
    expect(r.skippedByQuota).toBe(0);
  });

  it("alerta cujo preço ainda não cruzou o alvo não vira e-mail", async () => {
    h.getSnapshot.mockResolvedValue({
      date: "2026-08-03",
      avgPrice: 9.9, // acima do alvo (9)
      minPrice: 9.5,
      maxPrice: 10.2,
      sampleSize: 8,
      quotes: [],
    });
    h.alertRows = [linha("a1", "u1", "2026-01-01T00:00:00Z")];
    h.assinantes = ["u1"];

    const r = await evaluateAllFuelAlerts();

    expect(r.notified).toBe(0);
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("consulta o preço uma vez por série, não uma por alerta", async () => {
    // Vários alertas na MESMA série (donos diferentes, ambos pagos): o cache
    // interno tem de evitar N consultas iguais ao banco de preços.
    h.alertRows = [
      linha("a1", "x", "2026-01-01T00:00:00Z"),
      linha("a2", "y", "2026-01-01T00:00:00Z"),
      linha("a3", "z", "2026-01-01T00:00:00Z"),
    ];
    h.assinantes = ["x", "y", "z"];

    await evaluateAllFuelAlerts();

    expect(h.getSnapshot).toHaveBeenCalledTimes(1);
  });
});
