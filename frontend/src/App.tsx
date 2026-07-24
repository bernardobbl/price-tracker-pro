import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  createFuelAlert,
  createTrackedSeries,
  deleteTrackedSeries,
  fetchFuelProducts,
  fetchMunicipalities,
  fetchSeries,
  fetchSnapshot,
  fetchStates,
  fetchTrackedSeries,
} from "./api/client";
import type { FuelSeriesPoint, SeriesView, SnapshotSummary, TrackedSeries } from "./types";
import { PriceChart } from "./components/PriceChart";
import { Icon } from "./components/Icon";
import { ToastContainer } from "./components/Toast";
import { useToasts } from "./hooks/useToasts";
import { useAlerts } from "./hooks/useAlerts";
import { useCountUp } from "./hooks/useCountUp";
import { computePriceStats } from "./lib/priceStats";
import { computeDealSignal } from "./lib/dealSignal";
import {
  filterByPeriod,
  computeTrend,
  computeVolatility,
  PERIODS,
  type Period,
} from "./lib/priceInsights";
import { buildSeriesLabel, titleCase } from "./lib/seriesLabel";
import { seriesToHistory, ANP_SOURCE_URL } from "./lib/seriesToHistory";
import { supabase } from "./supabaseClient";

/** Formata um preço em R$ com casas decimais (combustível usa 3). */
function fmt(n: number, decimals = 3): string {
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Modo demonstração: quando ligado (`VITE_DEMO_MODE=true`), a UI avisa que os
 *  dados são uma amostra ilustrativa (postos/endereços gerados no seed), e não a
 *  base real da ANP. Desligado por padrão → em produção (dado real) nada aparece. */
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";

/** "AV BRASIL, 1234 · PINHEIROS" a partir dos campos de endereço (o que existir). */
function formatLocation(q: {
  street?: string | null;
  streetNumber?: string | null;
  neighborhood?: string | null;
}): string {
  const streetPart = [q.street ? titleCase(q.street) : "", q.streetNumber ?? ""]
    .filter(Boolean)
    .join(", ");
  const bairro = q.neighborhood ? titleCase(q.neighborhood) : "";
  return [streetPart, bairro].filter(Boolean).join(" · ");
}

/**
 * Link de busca no Google Maps a partir do que sabemos do posto: nome + endereço
 * + município/UF. Com os dados reais da ANP (endereço exato), o Maps localiza o
 * posto; na amostra de demo os postos são fictícios (ver `DEMO_MODE`).
 */
function mapsUrl(
  q: { reseller: string; street?: string | null; streetNumber?: string | null; neighborhood?: string | null },
  loc: { municipality: string; state: string }
): string {
  const query = [
    q.reseller,
    q.street ? titleCase(q.street) : "",
    q.streetNumber ?? "",
    q.neighborhood ? titleCase(q.neighborhood) : "",
    titleCase(loc.municipality),
    loc.state,
    "Brasil",
  ]
    .filter(Boolean)
    .join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Verdadeiro se dois recortes de série apontam para a mesma combinação. */
function sameSeries(a: SeriesView, b: { product: string; state: string; municipality: string; brand: string | null }): boolean {
  return (
    a.product === b.product &&
    a.state === b.state &&
    a.municipality === b.municipality &&
    (a.brand ?? null) === (b.brand ?? null)
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // ── Opções de exploração (dados públicos da ANP) ────────────────────────────
  const [products, setProducts] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [municipalities, setMunicipalities] = useState<string[]>([]);
  const [selProduct, setSelProduct] = useState("");
  const [selState, setSelState] = useState("");
  const [selMunicipality, setSelMunicipality] = useState("");

  // ── Favoritos + série em exibição ───────────────────────────────────────────
  const [tracked, setTracked] = useState<TrackedSeries[]>([]);
  const [view, setView] = useState<SeriesView | null>(null);
  const [series, setSeries] = useState<FuelSeriesPoint[]>([]);
  const [snapshot, setSnapshot] = useState<SnapshotSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("all");

  const [favSaving, setFavSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [alertThreshold, setAlertThreshold] = useState("");
  const [alertSaving, setAlertSaving] = useState(false);
  const [alertError, setAlertError] = useState<string | null>(null);

  const { toasts, push, remove: removeToast } = useToasts();
  const { alerts, reload: reloadAlerts, remove: removeAlert } = useAlerts(Boolean(supabase && user));

  const canManage = Boolean(supabase && user);

  // ── Sessão / auth ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }
    const timeout = setTimeout(() => setAuthLoading(false), 2000);
    void (async () => {
      const { data } = await supabase.auth.getSession();
      setUser(data.session?.user ?? null);
      clearTimeout(timeout);
      setAuthLoading(false);
    })();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

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

  // Favoritos do usuário.
  const reloadTracked = useCallback(async () => {
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
    void reloadTracked();
  }, [reloadTracked]);

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

  // ── Carregamento da série em exibição ───────────────────────────────────────
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
      setAlertThreshold("");
      setAlertError(null);
      setSelProduct(v.product);
      setSelState(v.state);
      setSelMunicipality(v.municipality);
      void loadSeries(v);
    },
    [loadSeries]
  );

  const handleExplore = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selProduct || !selState || !selMunicipality) return;
    openView({
      product: selProduct,
      state: selState,
      municipality: selMunicipality,
      brand: null,
      label: buildSeriesLabel(selProduct, selState, selMunicipality, null),
    });
  };

  // ── Favoritos ───────────────────────────────────────────────────────────────
  /** Garante que o recorte atual está favoritado; devolve o favorito. */
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

  const handleFavorite = async () => {
    if (!view) return;
    if (!canManage) {
      push("error", "Faça login para salvar favoritos.");
      return;
    }
    setFavSaving(true);
    try {
      await ensureFavorite(view);
      push("success", `"${view.label}" salvo nos favoritos.`);
    } catch (err: unknown) {
      push("error", err instanceof Error ? err.message : "Erro ao salvar favorito");
    } finally {
      setFavSaving(false);
    }
  };

  const handleDeleteFavorite = async (ts: TrackedSeries) => {
    setDeletingId(ts.id);
    try {
      await deleteTrackedSeries(ts.id);
      setTracked((prev) => prev.filter((t) => t.id !== ts.id));
      await reloadAlerts();
      push("success", `"${ts.label}" removido dos favoritos.`);
    } catch (err: unknown) {
      push("error", err instanceof Error ? err.message : "Erro ao excluir favorito");
    } finally {
      setDeletingId(null);
    }
  };

  // ── Alerta ──────────────────────────────────────────────────────────────────
  const handleCreateAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    setAlertError(null);

    if (!canManage) {
      setAlertError("Faça login para criar alertas.");
      return;
    }
    if (!view) {
      setAlertError("Escolha uma série primeiro.");
      return;
    }
    const numericThreshold = Number(alertThreshold.replace(",", "."));
    if (!numericThreshold || Number.isNaN(numericThreshold)) {
      setAlertError("Informe um valor válido para o alerta.");
      return;
    }

    setAlertSaving(true);
    try {
      const favorite = await ensureFavorite(view);
      await createFuelAlert({
        seriesId: favorite.id,
        thresholdPrice: numericThreshold,
        currency: "R$",
        channel: "email",
        enabled: true,
      });
      setAlertThreshold("");
      await Promise.all([reloadAlerts(), reloadTracked()]);
      push("success", "Alerta salvo! Você será avisado por email.");
    } catch (err: unknown) {
      setAlertError(err instanceof Error ? err.message : "Erro ao salvar alerta");
    } finally {
      setAlertSaving(false);
    }
  };

  const handleDeleteAlert = async (alertId: string) => {
    try {
      await removeAlert(alertId);
      push("success", "Alerta removido.");
    } catch (err: unknown) {
      push("error", err instanceof Error ? err.message : "Erro ao excluir alerta");
    }
  };

  // ── Auth handlers ─────────────────────────────────────────────────────────
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setAuthError(null);
    setAuthSubmitting(true);
    try {
      if (authMode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password: authPassword,
        });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: authEmail,
          password: authPassword,
        });
        if (error) throw error;
        if (!data.session) {
          setAuthMode("login");
          setAuthError("Conta criada. Confirme o email para conseguir entrar.");
          return;
        }
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message ?? "Erro de autenticação";
      setAuthError(msg);
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  // ── Derivados (recortados pelo período) ─────────────────────────────────────
  const history = seriesToHistory(series, view?.label ?? "");
  const viewHistory = filterByPeriod(history, period);
  const stats = computePriceStats(viewHistory);
  const deal = computeDealSignal(stats);
  const trend = computeTrend(viewHistory);
  const volatility = computeVolatility(stats);
  const latestAvg = history.length ? history[history.length - 1].discountedPrice : 0;
  const animatedPrice = useCountUp(latestAvg);
  const isFavorited = Boolean(view && tracked.some((t) => sameSeries(view, t)));
  const collectedDate = snapshot?.date ?? (series.length ? series[series.length - 1].date : null);

  // ── Tela de loading / login ─────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="app">
        <div className="auth-loading">Verificando sessão...</div>
      </div>
    );
  }

  if (supabase && !user) {
    return (
      <div className="app">
        <header className="header">
          <div className="header-brand">
            <span className="brand-mark"><Icon name="chart" size={20} /></span>
            <div>
              <h1>Price Tracker Pro</h1>
              <p>Preços reais de combustível (dados abertos da ANP)</p>
            </div>
          </div>
        </header>

        <div className="auth-page">
          <div className="auth-card">
            <div className="auth-card-logo">
              <h2>Price Tracker Pro</h2>
              <p>Entre na sua conta para continuar</p>
            </div>

            <div className="auth-tabs">
              <button
                type="button"
                className={`auth-tab${authMode === "login" ? " active" : ""}`}
                onClick={() => { setAuthMode("login"); setAuthError(null); }}
              >
                Entrar
              </button>
              <button
                type="button"
                className={`auth-tab${authMode === "signup" ? " active" : ""}`}
                onClick={() => { setAuthMode("signup"); setAuthError(null); }}
              >
                Criar conta
              </button>
            </div>

            <form onSubmit={handleAuthSubmit}>
              <div className="auth-fields">
                <div className="input-group">
                  <label htmlFor="auth-email">E-mail</label>
                  <input
                    id="auth-email"
                    type="email"
                    placeholder="seu@email.com"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    autoComplete="email"
                    required
                  />
                </div>
                <div className="input-group">
                  <label htmlFor="auth-password">Senha</label>
                  <input
                    id="auth-password"
                    type="password"
                    placeholder="••••••••"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    autoComplete={authMode === "login" ? "current-password" : "new-password"}
                    required
                  />
                </div>
              </div>

              {authError && <p className="error">{authError}</p>}

              <button
                type="submit"
                className="btn-primary"
                style={{ marginTop: authError ? "1rem" : "0.25rem" }}
                disabled={authSubmitting}
              >
                {authSubmitting
                  ? "Aguarde..."
                  : authMode === "login"
                    ? "Entrar na conta"
                    : "Criar conta"}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-brand">
          <h1>
            Price Tracker Pro
            {DEMO_MODE && (
              <span className="demo-badge" title="Amostra ilustrativa no layout da ANP — postos e endereços fictícios. Em produção, ingere o arquivo real da ANP.">
                dados de demonstração
              </span>
            )}
          </h1>
          <p>Preços reais de combustível (dados abertos da ANP)</p>
        </div>
        {canManage && (
          <div className="auth-row auth-row--logged">
            <span className="auth-email"><Icon name="user" size={14} /> {user!.email}</span>
            <button type="button" className="btn-logout" onClick={handleLogout}>
              <Icon name="logout" size={14} /> Sair
            </button>
          </div>
        )}
      </header>

      <main className="dashboard">
        {/* ── Sidebar: explorar + favoritos + alertas ── */}
        <aside className="sidebar">
          <div className="panel">
            <h2>Consultar preço</h2>
            <form className="explore-form" onSubmit={handleExplore}>
              <div className="input-group">
                <label htmlFor="sel-product">Combustível</label>
                <select
                  id="sel-product"
                  value={selProduct}
                  onChange={(e) => setSelProduct(e.target.value)}
                >
                  {products.length === 0 && <option value="">Carregando…</option>}
                  {products.map((p) => (
                    <option key={p} value={p}>{titleCase(p)}</option>
                  ))}
                </select>
              </div>
              <div className="input-group">
                <label htmlFor="sel-state">Estado (UF)</label>
                <select
                  id="sel-state"
                  value={selState}
                  onChange={(e) => { setSelState(e.target.value); setSelMunicipality(""); }}
                >
                  <option value="">Selecione…</option>
                  {states.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="input-group">
                <label htmlFor="sel-municipality">Município</label>
                <select
                  id="sel-municipality"
                  value={selMunicipality}
                  onChange={(e) => setSelMunicipality(e.target.value)}
                  disabled={!selState || municipalities.length === 0}
                >
                  <option value="">
                    {!selState ? "Escolha a UF primeiro" : municipalities.length === 0 ? "Sem dados" : "Selecione…"}
                  </option>
                  {municipalities.map((m) => (
                    <option key={m} value={m}>{titleCase(m)}</option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="btn-primary"
                disabled={!selProduct || !selState || !selMunicipality}
              >
                Ver preços
              </button>
            </form>
            {states.length === 0 && (
              <p className="muted empty-hint">
                Sem dados carregados ainda. Rode a ingestão da ANP no backend.
              </p>
            )}
          </div>

          {canManage && (
            <div className="panel">
              <h2>
                Favoritos <span className="count-badge">{tracked.length}</span>
              </h2>
              {tracked.length === 0 ? (
                <p className="muted empty-hint">
                  Nenhum favorito ainda. Consulte um preço e clique em “Favoritar”.
                </p>
              ) : (
                <ul className="product-list">
                  {tracked.map((t) => (
                    <li
                      key={t.id}
                      className={`product-card${view && sameSeries(view, t) ? " active" : ""}`}
                    >
                      <button
                        type="button"
                        className="product-card-btn"
                        onClick={() =>
                          openView({
                            product: t.product,
                            state: t.state,
                            municipality: t.municipality,
                            brand: t.brand,
                            label: t.label,
                          })
                        }
                      >
                        <span className="product-card-name">{t.label}</span>
                        <span className="product-card-id">{titleCase(t.municipality)}/{t.state}</span>
                      </button>
                      <button
                        type="button"
                        className="product-card-remove"
                        onClick={() => handleDeleteFavorite(t)}
                        disabled={deletingId === t.id}
                        aria-label={`Excluir ${t.label}`}
                        title="Excluir favorito"
                      >
                        {deletingId === t.id ? "..." : <Icon name="trash" size={15} />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {canManage && alerts.length > 0 && (
            <div className="panel">
              <h2>Alertas ativos</h2>
              <ul className="alert-list">
                {alerts.map((a) => (
                  <li key={a.id} className="alert-item">
                    <div className="alert-item-info">
                      <span className="alert-item-product">
                        {a.tracked_series?.label ?? "Série"}
                      </span>
                      <span className="alert-item-threshold">
                        abaixo de {a.currency} {fmt(Number(a.threshold_price))}
                        {a.triggered && <span className="alert-badge">disparado</span>}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn-icon-danger"
                      onClick={() => handleDeleteAlert(a.id)}
                      aria-label={`Remover alerta de ${a.tracked_series?.label ?? "série"}`}
                    >
                      Remover
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>

        {/* ── Painel de detalhe ── */}
        <section className="detail">
          {!view ? (
            <div className="detail-empty">
              <span className="detail-empty-icon"><Icon name="chart" size={34} /></span>
              <p>Escolha um combustível e um município para ver o histórico de preços.</p>
            </div>
          ) : (
            <div className="card detail-card">
              {error && <p className="error">{error}</p>}

              {loading && <div className="skeleton skeleton--summary" aria-hidden="true" />}

              {!loading && series.length === 0 && !error && (
                <p className="muted">Sem dados de preço para esta série ainda.</p>
              )}

              {!loading && series.length > 0 && (
                <>
                  <div className="detail-head">
                    <div className="detail-head-info">
                      <p className="detail-eyebrow">{view.label}</p>
                      <p className="price">
                        R$ {fmt(animatedPrice)}
                        <span className="price-unit">/L</span>
                        {deal.available && deal.tone === "success" && stats.isLowestEver && (
                          <span className="price-badge">Menor preço!</span>
                        )}
                      </p>
                      <p className="meta">média do município no levantamento mais recente</p>
                    </div>
                    {canManage && (
                      <button
                        type="button"
                        className={`btn-fav${isFavorited ? " btn-fav--on" : ""}`}
                        onClick={handleFavorite}
                        disabled={favSaving || isFavorited}
                        title={isFavorited ? "Já está nos favoritos" : "Salvar nos favoritos"}
                      >
                        <Icon name={isFavorited ? "check" : "tag"} size={14} />{" "}
                        {isFavorited ? "Favorito" : favSaving ? "Salvando…" : "Favoritar"}
                      </button>
                    )}
                  </div>

                  {deal.available && (
                    <div className={`deal deal--${deal.tone}`}>
                      <div className="deal-signal">
                        <span className="deal-label">{deal.label}</span>
                        <span className="deal-hint">{deal.hint}</span>
                      </div>
                      <div className="deal-score">
                        <span className="deal-score-value">{deal.score}</span>
                        <span className="deal-score-max">/100</span>
                      </div>
                    </div>
                  )}

                  {stats.min != null && stats.max != null && stats.max > stats.min && (
                    <div className="position">
                      <div className="position-labels">
                        <span>Menor · R$ {fmt(stats.min)}</span>
                        <span>Maior · R$ {fmt(stats.max)}</span>
                      </div>
                      <div className="position-track">
                        <div
                          className={`position-fill position-fill--${deal.tone}`}
                          style={{ width: `${Math.max(2, deal.positionPct)}%` }}
                        />
                        <div
                          className="position-marker"
                          style={{ left: `${deal.positionPct}%` }}
                          title={`Preço atual: R$ ${fmt(latestAvg)}`}
                        />
                      </div>
                    </div>
                  )}

                  <div className="segmented" role="group" aria-label="Período">
                    {PERIODS.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        className={`segmented-btn${period === p.value ? " active" : ""}`}
                        onClick={() => setPeriod(p.value)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  {viewHistory.length > 1 && (
                    <div className="stat-grid">
                      <div className="stat">
                        <span className="stat-label">Menor</span>
                        <span className="stat-value stat-value--low">R$ {fmt(stats.min ?? 0)}</span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">Média</span>
                        <span className="stat-value">R$ {fmt(stats.avg ?? 0)}</span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">Maior</span>
                        <span className="stat-value stat-value--high">R$ {fmt(stats.max ?? 0)}</span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">Variação</span>
                        <span
                          className={`stat-value ${
                            stats.changePct == null || stats.changePct === 0
                              ? ""
                              : stats.changePct > 0
                                ? "stat-value--high"
                                : "stat-value--low"
                          }`}
                        >
                          {stats.changePct == null
                            ? "—"
                            : `${stats.changePct > 0 ? "▲" : stats.changePct < 0 ? "▼" : ""} ${Math.abs(stats.changePct).toFixed(1)}%`}
                        </span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">Tendência</span>
                        <span
                          className={`stat-value ${
                            !trend.available
                              ? ""
                              : trend.dir === "up"
                                ? "stat-value--high"
                                : trend.dir === "down"
                                  ? "stat-value--low"
                                  : ""
                          }`}
                        >
                          {!trend.available
                            ? "—"
                            : `${trend.dir === "up" ? "↗" : trend.dir === "down" ? "↘" : "→"} ${trend.label}`}
                        </span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">Volatilidade</span>
                        <span className="stat-value">
                          {volatility.available ? volatility.level : "—"}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="detail-chart">
                    <div className="detail-chart-head">
                      <h2>Evolução de preço</h2>
                    </div>
                    <PriceChart data={viewHistory} decimals={3} />
                  </div>

                  {/* ── Ranking de postos: onde está mais barato (I2) ── */}
                  {snapshot && snapshot.quotes.length > 0 && (
                    <div className="ranking">
                      <div className="detail-chart-head">
                        <h2>Onde está mais barato</h2>
                        {snapshot.date && (
                          <span className="ranking-date">
                            levantamento de {new Date(snapshot.date).toLocaleDateString("pt-BR")}
                          </span>
                        )}
                      </div>
                      <ul className="ranking-list">
                        {snapshot.quotes.slice(0, 8).map((q, i) => {
                          const loc = formatLocation(q);
                          return (
                            <li key={q.cnpj || i} className={`ranking-row${i === 0 ? " ranking-row--best" : ""}`}>
                              <span className="ranking-pos">{i + 1}</span>
                              <div className="ranking-info">
                                <span className="ranking-name">
                                  {titleCase(q.reseller || "Posto")}
                                  {q.brand && <span className="ranking-brand">{titleCase(q.brand)}</span>}
                                </span>
                                <a
                                  className="ranking-loc"
                                  href={mapsUrl(q, view)}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="Ver no Google Maps"
                                >
                                  <Icon name="map-pin" size={12} />
                                  {loc || "Ver no mapa"}
                                </a>
                              </div>
                              <span className="ranking-price">R$ {fmt(q.sellPrice)}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  <p className="meta detail-meta">
                    {collectedDate && `Atualizado em ${new Date(collectedDate).toLocaleDateString("pt-BR")}`}
                    {series.length > 1 && ` · ${series.length} levantamentos`}
                    {" · "}
                    <a href={ANP_SOURCE_URL} target="_blank" rel="noreferrer">
                      Fonte: ANP
                    </a>
                  </p>

                  {canManage && (
                    <form className="form alert-form" onSubmit={handleCreateAlert}>
                      <h3 className="alert-form-title">Alerta de preço</h3>
                      <div className="alert-field">
                        <label htmlFor="alert-threshold">Me avise quando a média cair abaixo de (R$/L)</label>
                        <div className="alert-controls">
                          <input
                            id="alert-threshold"
                            type="number"
                            step="0.001"
                            placeholder={(stats.avg ?? latestAvg).toFixed(3)}
                            value={alertThreshold}
                            onChange={(e) => setAlertThreshold(e.target.value)}
                          />
                          <button type="submit" className="btn-alert" disabled={alertSaving}>
                            {alertSaving ? "Salvando..." : "Ativar alerta"}
                          </button>
                        </div>
                      </div>
                      {alertError && <p className="error">{alertError}</p>}
                    </form>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      </main>

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
}

export default App;
