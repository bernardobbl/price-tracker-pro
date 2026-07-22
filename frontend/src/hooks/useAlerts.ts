import { useCallback, useEffect, useState } from "react";
import type { Alert } from "../types";
import { deleteAlert as apiDeleteAlert, fetchAlerts } from "../api/client";

/** Carrega e gerencia os alertas do usuário. */
export function useAlerts(enabled: boolean) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!enabled) {
      setAlerts([]);
      return;
    }
    setLoading(true);
    try {
      setAlerts(await fetchAlerts());
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
    await apiDeleteAlert(id);
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return { alerts, loading, reload, remove };
}
