import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchFuelProducts,
  fetchMunicipalities,
  fetchSeries,
  fetchSnapshot,
  fetchStates,
} from "../api/client";
import type { FuelSeriesPoint, SeriesView, SnapshotSummary } from "../types";
import { buildSeriesLabel } from "../lib/seriesLabel";
import { lerSerieDaUrl } from "../lib/seriesFromUrl";
import { type Period } from "../lib/priceInsights";

/**
 * Domínio de consulta de combustível (dados públicos da ANP): opções de
 * exploração (produto → UF → município), a série em exibição e o snapshot do
 * levantamento mais recente. Seleções e série são acopladas (abrir um favorito
 * sincroniza os selects), então vivem no mesmo hook.
 */
export function useFuelSeries() {
  const [products, setProducts] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [municipalities, setMunicipalities] = useState<string[]>([]);
  const [selProduct, setSelProduct] = useState("");
  const [selState, setSelStateRaw] = useState("");
  const [selMunicipality, setSelMunicipality] = useState("");

  const [view, setView] = useState<SeriesView | null>(null);
  const [series, setSeries] = useState<FuelSeriesPoint[]>([]);
  const [snapshot, setSnapshot] = useState<SnapshotSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("all");

  // Opções públicas: carregam uma vez, independem de login.
  useEffect(() => {
    void (async () => {
      try {
        const [prods, sts] = await Promise.all([fetchFuelProducts(), fetchStates()]);
        setProducts(prods);
        setStates(sts);
        if (prods.length > 0) setSelProduct((p) => p || prods[0]);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Erro ao carregar opções");
      }
    })();
  }, []);

  // Primeira impressão: com as opções carregadas e nada em exibição, abre uma
  // série. Prioridade: (1) a série pedida na URL — é assim que o link do email de
  // alerta abre exatamente a série do alerta, e o que torna qualquer consulta
  // compartilhável; (2) o padrão Gasolina · São Paulo/SP, para o visitante que
  // chega na home ver o produto funcionando sem escolher nada.
  // Roda uma única vez e nunca sobrescreve uma escolha do usuário (guarda `view`).
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (autoLoaded.current || view || products.length === 0 || states.length === 0) return;
    autoLoaded.current = true;

    const daUrl = lerSerieDaUrl(window.location.search);
    if (daUrl) {
      openView({
        ...daUrl,
        label: buildSeriesLabel(daUrl.product, daUrl.state, daUrl.municipality, daUrl.brand),
      });
      return;
    }

    void (async () => {
      const product = products.includes("GASOLINA") ? "GASOLINA" : products[0];
      const state = states.includes("SP") ? "SP" : states[0];
      try {
        const muns = await fetchMunicipalities(state);
        if (muns.length === 0) return;
        const municipality = muns.includes("SAO PAULO") ? "SAO PAULO" : muns[0];
        openView({
          product,
          state,
          municipality,
          brand: null,
          label: buildSeriesLabel(product, state, municipality, null),
        });
      } catch {
        // Silencioso: sem série padrão, o visitante ainda explora manualmente.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openView é estável (useCallback)
  }, [products, states, view]);

  // Municípios da UF selecionada.
  useEffect(() => {
    if (!selState) {
      setMunicipalities([]);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const list = await fetchMunicipalities(selState);
        if (active) setMunicipalities(list);
      } catch {
        if (active) setMunicipalities([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [selState]);

  /** Troca de UF zera o município selecionado. */
  const setSelState = useCallback((uf: string) => {
    setSelStateRaw(uf);
    setSelMunicipality("");
  }, []);

  const loadSeries = useCallback(async (v: SeriesView) => {
    setLoading(true);
    setError(null);
    try {
      const query = { product: v.product, state: v.state, municipality: v.municipality, brand: v.brand };
      const [pts, snap] = await Promise.all([fetchSeries(query), fetchSnapshot(query)]);
      setSeries(pts);
      setSnapshot(snap);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao carregar a série");
      setSeries([]);
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const openView = useCallback(
    (v: SeriesView) => {
      setView(v);
      setPeriod("all");
      setSelProduct(v.product);
      setSelStateRaw(v.state);
      setSelMunicipality(v.municipality);
      void loadSeries(v);
    },
    [loadSeries]
  );

  /** Abre a série a partir das seleções atuais dos selects. */
  const explore = useCallback(() => {
    if (!selProduct || !selState || !selMunicipality) return;
    openView({
      product: selProduct,
      state: selState,
      municipality: selMunicipality,
      brand: null,
      label: buildSeriesLabel(selProduct, selState, selMunicipality, null),
    });
  }, [selProduct, selState, selMunicipality, openView]);

  return {
    options: { products, states, municipalities },
    selection: { selProduct, selState, selMunicipality, setSelProduct, setSelState, setSelMunicipality },
    view,
    series,
    snapshot,
    loading,
    error,
    period,
    setPeriod,
    openView,
    explore,
  };
}
