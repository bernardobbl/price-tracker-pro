import { useCallback, useEffect, useState } from "react";
import type { FuelAlert } from "../types";
import { deleteFuelAlert, fetchFuelAlerts } from "../api/client";

/** Carrega e gerencia os alertas de combustível do usuário. */
export function useAlerts(enabled: boolean) {
  const [alerts, setAlerts] = useState<FuelAlert[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!enabled) {
      setAlerts([]);
      return;
    }
    setLoading(true);
    try {
      setAlerts(await fetchFuelAlerts());
    } catch {
      // Falha silenciosa: a UI apenas mostra a lista vazia.
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const remove = useCallback(async (id: string) => {
    await deleteFuelAlert(id);
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return { alerts, loading, reload, remove };
}
