import { useCallback, useEffect, useState } from "react";
import { createTrackedSeries, deleteTrackedSeries, fetchTrackedSeries } from "../api/client";
import type { SeriesView, TrackedSeries } from "../types";
import { sameSeries } from "../lib/format";

/**
 * Favoritos do usuário (séries salvas). `ensureFavorite` é idempotente: devolve
 * o favorito existente ou cria um novo — reaproveitado tanto pelo botão
 * "Favoritar" quanto pelo fluxo "favoritar-e-alertar".
 */
export function useFavorites(canManage: boolean) {
  const [tracked, setTracked] = useState<TrackedSeries[]>([]);
  const [favSaving, setFavSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!canManage) {
      setTracked([]);
      return;
    }
    try {
      setTracked(await fetchTrackedSeries());
    } catch {
      setTracked([]);
    }
  }, [canManage]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * Devolve o favorito da série, criando-o se ainda não existir.
   *
   * O segundo campo (`created`) existe por causa de um efeito colateral visto
   * em produção: o fluxo "favoritar-e-alertar" chama isto **antes** de pedir o
   * alerta, e quando o alerta é recusado pela cota do plano gratuito, o
   * favorito já tinha sido criado. Na tela: a pessoa clica em "Ativar alerta",
   * o sistema responde que não pode — e a barra lateral ganha um favorito que
   * ela não pediu. Ação recusada não deve deixar rastro.
   *
   * Quem chama precisa saber se **esta chamada** criou a linha para poder
   * desfazê-la. Reaproveitar um favorito que já existia e apagá-lo depois seria
   * pior que o defeito original — destruiria algo que a pessoa salvou antes.
   */
  const ensureFavorite = useCallback(
    async (v: SeriesView): Promise<{ favorite: TrackedSeries; created: boolean }> => {
      const existing = tracked.find((t) => sameSeries(v, t));
      if (existing) return { favorite: existing, created: false };
      const created = await createTrackedSeries({
        product: v.product,
        state: v.state,
        municipality: v.municipality,
        brand: v.brand ?? undefined,
        label: v.label,
      });
      setTracked((prev) => (prev.some((t) => t.id === created.id) ? prev : [...prev, created]));
      return { favorite: created, created: true };
    },
    [tracked]
  );

  /** `ensureFavorite` com o flag de "salvando" para o botão Favoritar. */
  const saveFavorite = useCallback(
    async (v: SeriesView): Promise<TrackedSeries> => {
      setFavSaving(true);
      try {
        return (await ensureFavorite(v)).favorite;
      } finally {
        setFavSaving(false);
      }
    },
    [ensureFavorite]
  );

  /**
   * Desfaz um favorito criado por engano, sem barulho na tela.
   *
   * Usado só como compensação de uma operação que falhou logo depois de criá-lo.
   * Silencioso de propósito: a pessoa já está vendo o erro que importa (a cota),
   * e um segundo aviso dizendo "não consegui desfazer o favorito" só competiria
   * com ele. Se a limpeza falhar, o pior caso é o estado de antes desta correção
   * — um favorito a mais —, então não vale sequestrar a atenção por isso.
   */
  const discardFavorite = useCallback(async (id: string) => {
    try {
      await deleteTrackedSeries(id);
      setTracked((prev) => prev.filter((t) => t.id !== id));
    } catch {
      // Ver o comentário acima: falhar aqui não piora nada que a pessoa veja.
    }
  }, []);

  const removeFavorite = useCallback(async (id: string) => {
    setDeletingId(id);
    try {
      await deleteTrackedSeries(id);
      setTracked((prev) => prev.filter((t) => t.id !== id));
    } finally {
      setDeletingId(null);
    }
  }, []);

  return {
    tracked,
    favSaving,
    deletingId,
    reload,
    ensureFavorite,
    saveFavorite,
    removeFavorite,
    discardFavorite,
  };
}
