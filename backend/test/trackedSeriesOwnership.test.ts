/**
 * Posse da série (`getOwnedTrackedSeries`).
 *
 * Por que este teste importa: o backend fala com o Supabase usando a chave
 * `service_role`, que **bypassa o RLS**. Ou seja, as políticas do banco NÃO são a
 * proteção efetiva nas rotas — o filtro explícito por `user_id` é. Este teste trava
 * esse contrato: a consulta precisa filtrar por `id` **e** por `user_id`, e devolver
 * `null` (→ 404 na rota) quando a série é de outra pessoa.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  table: "" as string,
  eqCalls: [] as Array<[string, unknown]>,
  row: null as Record<string, unknown> | null,
  error: null as { message: string } | null,
}));

vi.mock("../src/config/supabaseClient", () => {
  interface Builder {
    select: () => Builder;
    eq: (column: string, value: unknown) => Builder;
    maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
  }

  const builder: Builder = {
    select: () => builder,
    eq: (column, value) => {
      h.eqCalls.push([column, value]);
      return builder;
    },
    maybeSingle: async () => ({ data: h.row, error: h.error }),
  };

  return {
    supabase: {
      from: (table: string) => {
        h.table = table;
        return builder;
      },
    },
  };
});

import { getOwnedTrackedSeries } from "../src/services/trackedSeriesService";

const SERIES_ID = "11111111-1111-1111-1111-111111111111";
const OWNER = "user-a";
const INTRUDER = "user-b";

const dbRow = {
  id: SERIES_ID,
  product: "GASOLINA",
  state: "SP",
  municipality: "SAO PAULO",
  brand: null,
  label: "Gasolina · São Paulo/SP",
  created_at: "2026-07-01T00:00:00Z",
};

describe("getOwnedTrackedSeries", () => {
  beforeEach(() => {
    h.table = "";
    h.eqCalls = [];
    h.row = null;
    h.error = null;
  });

  it("devolve a série quando ela pertence ao usuário", async () => {
    h.row = dbRow;
    const series = await getOwnedTrackedSeries(SERIES_ID, OWNER);

    expect(series).not.toBeNull();
    expect(series?.id).toBe(SERIES_ID);
    expect(series?.label).toBe("Gasolina · São Paulo/SP");
  });

  it("filtra por id E por user_id (RLS não protege sob service_role)", async () => {
    h.row = dbRow;
    await getOwnedTrackedSeries(SERIES_ID, OWNER);

    expect(h.table).toBe("tracked_series");
    expect(h.eqCalls).toEqual([
      ["id", SERIES_ID],
      ["user_id", OWNER],
    ]);
  });

  it("devolve null para série de outro usuário (banco não retorna linha)", async () => {
    h.row = null; // o filtro por user_id não casa → nenhuma linha
    const series = await getOwnedTrackedSeries(SERIES_ID, INTRUDER);

    expect(series).toBeNull();
    expect(h.eqCalls).toContainEqual(["user_id", INTRUDER]);
  });

  it("devolve null sem usuário autenticado, sem nem consultar o banco", async () => {
    expect(await getOwnedTrackedSeries(SERIES_ID, undefined)).toBeNull();
    expect(await getOwnedTrackedSeries(SERIES_ID, null)).toBeNull();
    expect(h.table).toBe("");
  });

  it("falha fechado (null) quando a consulta dá erro", async () => {
    h.error = { message: "connection reset" };
    expect(await getOwnedTrackedSeries(SERIES_ID, OWNER)).toBeNull();
  });
});
