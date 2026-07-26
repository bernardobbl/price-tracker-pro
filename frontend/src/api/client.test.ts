/**
 * Resiliência da camada de API ao cold start do free tier.
 *
 * O contrato que estes testes travam:
 *   1. leitura (GET) é repetida uma vez quando a rede falha — é o caso do backend
 *      hibernado, em que a 1ª tentativa morre e a 2ª pega o serviço já de pé;
 *   2. escrita (POST/DELETE) NUNCA é repetida — repetir criaria favorito/alerta
 *      duplicado, que é pior do que mostrar o erro;
 *   3. a UI é avisada quando a espera passa do normal, e desavisada ao terminar.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  __resetApiWakingState,
  createTrackedSeries,
  fetchFuelProducts,
  onApiWaking,
} from "./client";

vi.mock("../supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "token-de-teste" } } }),
    },
  },
}));

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("apiFetch — retry e cold start", () => {
  beforeEach(() => {
    __resetApiWakingState();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("repete a leitura uma vez quando a 1ª tentativa falha na rede", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(jsonResponse(["GASOLINA", "ETANOL"]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchFuelProducts()).resolves.toEqual(["GASOLINA", "ETANOL"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("desiste com mensagem amigável quando as duas tentativas falham", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchFuelProducts()).rejects.toThrow(/servidor/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("NÃO repete escrita — evita favorito duplicado", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createTrackedSeries({ product: "GASOLINA", state: "SP", municipality: "SAO PAULO" })
    ).rejects.toThrow(/servidor/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("avisa a UI quando a requisição demora, e desavisa ao terminar", async () => {
    vi.useFakeTimers();
    const states: boolean[] = [];
    onApiWaking((waking) => states.push(waking));

    let settle: (value: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        () =>
          new Promise<Response>((resolve) => {
            settle = resolve;
          })
      )
    );

    const pending = fetchFuelProducts();

    await vi.advanceTimersByTimeAsync(4_000); // passou do limiar de "lento"
    expect(states).toEqual([true]);

    settle(jsonResponse(["GASOLINA"]));
    await pending;
    expect(states).toEqual([true, false]);
  });

  it("não avisa nada quando a resposta é rápida", async () => {
    const states: boolean[] = [];
    onApiWaking((waking) => states.push(waking));
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(["GASOLINA"])));

    await fetchFuelProducts();
    expect(states).toEqual([]);
  });
});
