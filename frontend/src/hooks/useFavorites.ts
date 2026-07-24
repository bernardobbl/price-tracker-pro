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

  const ensureFavorite = useCallback(
    async (v: SeriesView): Promise<TrackedSeries> => {
      const existing = tracked.find((t) => sameSeries(v, t));
      if (existing) return existing;
      const created = await createTrackedSeries({
        product: v.product,
        state: v.state,
        municipality: v.municipality,
        brand: v.brand ?? undefined,
        label: v.label,
      });
      setTracked((prev) => (prev.some((t) => t.id === created.id) ? prev : [...prev, created]));
      return created;
    },
    [tracked]
  );

  /** `ensureFavorite` com o flag de "salvando" para o botão Favoritar. */
  const saveFavorite = useCallback(
    async (v: SeriesView): Promise<TrackedSeries> => {
      setFavSaving(true);
      try {
        return await ensureFavorite(v);
      } finally {
        setFavSaving(false);
      }
    },
    [ensureFavorite]
  );

  const removeFavorite = useCallback(async (id: string) => {
    setDeletingId(id);
    try {
      await deleteTrackedSeries(id);
      setTracked((prev) => prev.filter((t) => t.id !== id));
    } finally {
      setDeletingId(null);
    }
  }, []);

  return { tracked, favSaving, deletingId, reload, ensureFavorite, saveFavorite, removeFavorite };
}
