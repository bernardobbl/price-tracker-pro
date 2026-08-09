import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useFavorites } from "./useFavorites";
import type { TrackedSeries, SeriesView } from "../types";

/**
 * `ensureFavorite` e o favorito fantasma.
 *
 * Achado usando o produto em produção, não lendo código: numa conta gratuita
 * que já tinha um alerta, clicar em "Ativar alerta" numa segunda série devolvia
 * o aviso de cota — **e a barra lateral ganhava um favorito novo**. A pessoa
 * pediu um alerta, o sistema disse não, e mudou os dados dela mesmo assim.
 *
 * A causa é a ordem obrigatória do fluxo: alerta exige série favoritada, então
 * o favorito nasce primeiro e a recusa vem depois. A correção não é inverter a
 * ordem (não dá) — é **desfazer o que esta tentativa criou**.
 *
 * O que estes testes trancam, e a distinção é o ponto: desfazer só o favorito
 * criado **agora**. Apagar um favorito que já existia seria destruir algo que a
 * pessoa salvou antes — trocar um incômodo por perda de dado.
 */

vi.mock("../api/client", () => ({
  createTrackedSeries: vi.fn(),
  deleteTrackedSeries: vi.fn(),
  fetchTrackedSeries: vi.fn(),
}));

const client = await import("../api/client");
const createTrackedSeries = vi.mocked(client.createTrackedSeries);
const deleteTrackedSeries = vi.mocked(client.deleteTrackedSeries);
const fetchTrackedSeries = vi.mocked(client.fetchTrackedSeries);

const view: SeriesView = {
  product: "ETANOL",
  state: "SP",
  municipality: "SAO PAULO",
  brand: null,
  label: "Etanol · Sao Paulo/SP",
};

const favoritoEtanol: TrackedSeries = {
  id: "fav-etanol",
  product: "ETANOL",
  state: "SP",
  municipality: "SAO PAULO",
  brand: null,
  label: "Etanol · Sao Paulo/SP",
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchTrackedSeries.mockResolvedValue([]);
  createTrackedSeries.mockResolvedValue(favoritoEtanol);
  deleteTrackedSeries.mockResolvedValue(undefined);
});

describe("ensureFavorite diz se foi ELE quem criou", () => {
  it("created=true quando a série ainda não estava favoritada", async () => {
    const { result } = renderHook(() => useFavorites(true));
    await waitFor(() => expect(fetchTrackedSeries).toHaveBeenCalled());

    let saida!: { favorite: TrackedSeries; created: boolean };
    await act(async () => {
      saida = await result.current.ensureFavorite(view);
    });

    expect(saida.created).toBe(true);
    expect(saida.favorite.id).toBe("fav-etanol");
    expect(createTrackedSeries).toHaveBeenCalledTimes(1);
  });

  it("created=false quando a série já era favorita — e não cria de novo", async () => {
    fetchTrackedSeries.mockResolvedValue([favoritoEtanol]);
    const { result } = renderHook(() => useFavorites(true));
    await waitFor(() => expect(result.current.tracked).toHaveLength(1));

    let saida!: { favorite: TrackedSeries; created: boolean };
    await act(async () => {
      saida = await result.current.ensureFavorite(view);
    });

    // É esta distinção que impede a correção de virar perda de dado: um
    // favorito que a pessoa salvou semanas atrás não pode ser apagado porque
    // um alerta foi recusado hoje.
    expect(saida.created).toBe(false);
    expect(createTrackedSeries).not.toHaveBeenCalled();
  });
});

describe("discardFavorite — a compensação", () => {
  it("apaga do servidor e da lista da tela", async () => {
    fetchTrackedSeries.mockResolvedValue([favoritoEtanol]);
    const { result } = renderHook(() => useFavorites(true));
    await waitFor(() => expect(result.current.tracked).toHaveLength(1));

    await act(async () => {
      await result.current.discardFavorite("fav-etanol");
    });

    expect(deleteTrackedSeries).toHaveBeenCalledWith("fav-etanol");
    expect(result.current.tracked).toHaveLength(0);
  });

  it("engole a falha em silêncio — não rouba a tela do erro que importa", async () => {
    // Quem chama isto está no meio de mostrar o aviso de cota. Um segundo erro
    // dizendo "não consegui desfazer o favorito" competiria com a mensagem que
    // a pessoa precisa ler, para resolver algo que ela nem sabe que aconteceu.
    deleteTrackedSeries.mockRejectedValue(new Error("rede caiu"));
    fetchTrackedSeries.mockResolvedValue([favoritoEtanol]);

    const { result } = renderHook(() => useFavorites(true));
    await waitFor(() => expect(result.current.tracked).toHaveLength(1));

    await act(async () => {
      await expect(result.current.discardFavorite("fav-etanol")).resolves.toBeUndefined();
    });
  });
});
