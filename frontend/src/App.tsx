import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  createAlert,
  createProduct,
  deleteProduct,
  fetchPriceHistory,
  fetchProducts,
  searchProducts,
  trackPriceNow,
  type SearchResultItem
} from "./api/client";
import type { PriceHistoryItem, TrackedProduct } from "./types";
import { PriceChart } from "./components/PriceChart";
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
  type Period
} from "./lib/priceInsights";
import { supabase } from "./supabaseClient";

/** "A Light in the Attic" → "a-light-in-the-attic" */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const [products, setProducts] = useState<TrackedProduct[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [history, setHistory] = useState<PriceHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newProductName, setNewProductName] = useState("");
  const [alertThreshold, setAlertThreshold] = useState("");
  const [alertSaving, setAlertSaving] = useState(false);
  const [alertError, setAlertError] = useState<string | null>(null);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("all");

  const { toasts, push, remove: removeToast } = useToasts();
  const { alerts, reload: reloadAlerts, remove: removeAlert } = useAlerts(Boolean(supabase && user));

  // ── Busca livre (instantânea, com debounce) ────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [trackingId, setTrackingId] = useState<string | null>(null);

  const runSearch = useCallback(async (q: string) => {
    const query = q.trim();
    if (!query) {
      setSearchResults([]);
      setSearchError(null);
      return;
    }
    setSearchLoading(true);
    setSearchError(null);
    try {
      const data = await searchProducts(query);
      setSearchResults(data);
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : "Erro inesperado na busca");
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  // Dispara a busca ~350ms após parar de digitar.
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }
    const timer = setTimeout(() => void runSearch(q), 350);
    return () => clearTimeout(timer);
  }, [searchQuery, runSearch]);
  // ────────────────────────────────────────────────────────────────────────

  const loadData = useCallback(async (id: string) => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchPriceHistory(id);
      setHistory(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProductsAndMaybeSelect = useCallback(async () => {
    try {
      const list = await fetchProducts();
      setProducts(list);
      if (!selectedProductId && list.length > 0) {
        setSelectedProductId(list[0].id);
        void loadData(list[0].id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao carregar produtos");
    }
  }, [selectedProductId, loadData]);

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
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase) {
      void loadProductsAndMaybeSelect();
      return;
    }

    if (!user) {
      setProducts([]);
      setSelectedProductId("");
      setHistory([]);
      return;
    }

    void loadProductsAndMaybeSelect();
  }, [user, loadProductsAndMaybeSelect]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;

    setAuthError(null);
    setAuthSubmitting(true);

    try {
      if (authMode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password: authPassword
        });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: authEmail,
          password: authPassword
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

  const selectProduct = (id: string) => {
    setSelectedProductId(id);
    void loadData(id);
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    const name = newProductName.trim();
    if (!name) {
      setCreateError("Digite o nome do produto.");
      return;
    }
    const id = slugify(name);
    try {
      setCreating(true);
      const created = await createProduct({ id, name, searchQuery: name, marketplace: "books-to-scrape" });
      setProducts((prev) => [...prev, created]);
      setSelectedProductId(created.id);
      setNewProductName("");
      await trackPriceNow(created.id);
      await loadData(created.id);
      push("success", `"${created.name}" cadastrado e rastreado!`);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Erro ao cadastrar produto");
    } finally {
      setCreating(false);
    }
  };

  const handleTrackFromSearch = async (item: SearchResultItem) => {
    const name = item.title.trim();
    const id = slugify(name);
    setTrackingId(id);
    try {
      let created = products.find((p) => p.id === id);
      if (!created) {
        try {
          created = await createProduct({
            id,
            name,
            searchQuery: name,
            marketplace: "books-to-scrape"
          });
          setProducts((prev) => [...prev, created as TrackedProduct]);
        } catch (err: unknown) {
          const existing = products.find((p) => p.id === id);
          if (!existing) throw err;
          created = existing;
        }
      }
      setSelectedProductId(created.id);
      await trackPriceNow(created.id);
      await loadData(created.id);
      push("success", `"${created.name}" rastreado!`);
    } catch (err: unknown) {
      push("error", err instanceof Error ? err.message : "Erro ao rastrear produto");
    } finally {
      setTrackingId(null);
    }
  };

  const handleDeleteProduct = async (product: TrackedProduct) => {
    setDeletingProductId(product.id);
    try {
      await deleteProduct(product.id);
      const remaining = products.filter((p) => p.id !== product.id);
      setProducts(remaining);
      if (selectedProductId === product.id) {
        const next = remaining[0]?.id ?? "";
        setSelectedProductId(next);
        if (next) {
          void loadData(next);
        } else {
          setHistory([]);
        }
      }
      await reloadAlerts();
      push("success", `"${product.name}" removido.`);
    } catch (err: unknown) {
      push("error", err instanceof Error ? err.message : "Erro ao excluir produto");
    } finally {
      setDeletingProductId(null);
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

  const handleCreateAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    setAlertError(null);

    if (!supabase) {
      setAlertError("Alertas requerem Supabase configurado.");
      return;
    }

    if (!user) {
      setAlertError("Faça login para criar alertas.");
      return;
    }

    if (!selectedProductId || !latest) {
      setAlertError("Selecione um produto e carregue o último preço.");
      return;
    }

    const numericThreshold = Number(alertThreshold.replace(",", "."));
    if (!numericThreshold || Number.isNaN(numericThreshold)) {
      setAlertError("Informe um valor válido para o alerta.");
      return;
    }

    try {
      setAlertSaving(true);
      await createAlert({
        productId: selectedProductId,
        thresholdPrice: numericThreshold,
        currency: latest.currency,
        channel: "email",
        enabled: true,
        currentPrice: latest.discountedPrice,
        productName: latest.title,
        productUrl: latest.url
      });

      setAlertThreshold("");
      await reloadAlerts();
      push("success", "Alerta salvo! Você será avisado por email.");
    } catch (err: unknown) {
      setAlertError(err instanceof Error ? err.message : "Erro ao salvar alerta");
    } finally {
      setAlertSaving(false);
    }
  };

  // ── Derivados (recortados pelo período selecionado) ─────────────────────────
  const latest = history[history.length - 1];
  const viewHistory = filterByPeriod(history, period);
  const stats = computePriceStats(viewHistory);
  const deal = computeDealSignal(stats);
  const trend = computeTrend(viewHistory);
  const volatility = computeVolatility(stats);
  const selectedProduct = products.find((p) => p.id === selectedProductId);
  const animatedPrice = useCountUp(latest?.discountedPrice ?? 0);

  // Tela de loading
  if (authLoading) {
    return (
      <div className="app">
        <div className="auth-loading">Verificando sessão...</div>
      </div>
    );
  }

  // Tela de login
  if (supabase && !user) {
    return (
      <div className="app">
        <header className="header">
          <div className="header-brand">
            <h1>Price Tracker Pro</h1>
            <p>Rastreie preços de livros (Books to Scrape)</p>
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

  const canManage = Boolean(supabase && user);
  const discountPct =
    latest && latest.fullPrice > latest.discountedPrice
      ? Math.round((1 - latest.discountedPrice / latest.fullPrice) * 100)
      : 0;

  return (
    <div className="app">
      <header className="header">
        <div className="header-brand">
          <h1>Price Tracker Pro</h1>
          <p>Rastreie preços de livros (Books to Scrape)</p>
        </div>
        {canManage && (
          <div className="auth-row auth-row--logged">
            <span className="auth-email">👤 {user!.email}</span>
            <button type="button" className="btn-logout" onClick={handleLogout}>
              Sair
            </button>
          </div>
        )}
      </header>

      <main className="dashboard">
        {/* ── Sidebar: busca + produtos + alertas ── */}
        <aside className="sidebar">
          <div className="panel">
            <h2>Buscar produto</h2>
            <div className="search-box">
              <span className="search-box-icon" aria-hidden="true">🔎</span>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Ex: light, velvet, the..."
                aria-label="Buscar livros"
              />
              {searchLoading && <span className="spinner" aria-hidden="true" />}
            </div>

            {searchError && <p className="error">{searchError}</p>}

            {searchLoading && searchResults.length === 0 && (
              <div className="search-results">
                <div className="skeleton skeleton--row" aria-hidden="true" />
                <div className="skeleton skeleton--row" aria-hidden="true" />
                <div className="skeleton skeleton--row" aria-hidden="true" />
              </div>
            )}

            {!searchLoading && searchResults.length > 0 && (
              <ul className="search-results">
                {searchResults.map((item) => {
                  const id = slugify(item.title);
                  const tracked = products.some((p) => p.id === id);
                  return (
                    <li key={item.url} className="search-item">
                      <div className="search-item-main">
                        <a href={item.url} target="_blank" rel="noreferrer" className="search-item-title">
                          {item.title}
                        </a>
                        <span className="search-item-price">
                          {item.currency} {item.price.toFixed(2)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn-track"
                        onClick={() => handleTrackFromSearch(item)}
                        disabled={trackingId === id}
                        title={tracked ? "Atualizar preço agora" : "Rastrear este produto"}
                      >
                        {trackingId === id ? "..." : tracked ? "✓ Rastreando" : "🔔 Rastrear"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {!searchLoading && searchQuery.trim() && !searchError && searchResults.length === 0 && (
              <p className="muted empty-hint">Nenhum livro encontrado para &quot;{searchQuery.trim()}&quot;.</p>
            )}
          </div>

          <div className="panel">
            <h2>
              Rastreando <span className="count-badge">{products.length}</span>
            </h2>

            {products.length === 0 ? (
              <p className="muted empty-hint">Nenhum produto ainda. Busque acima e clique em Rastrear.</p>
            ) : (
              <ul className="product-list">
                {products.map((p) => (
                  <li
                    key={p.id}
                    className={`product-card${p.id === selectedProductId ? " active" : ""}`}
                  >
                    <button
                      type="button"
                      className="product-card-btn"
                      onClick={() => selectProduct(p.id)}
                    >
                      <span className="product-card-name">{p.name}</span>
                      <span className="product-card-id">{p.id}</span>
                    </button>
                    {canManage && (
                      <button
                        type="button"
                        className="product-card-remove"
                        onClick={() => handleDeleteProduct(p)}
                        disabled={deletingProductId === p.id}
                        aria-label={`Excluir ${p.name}`}
                        title="Excluir produto"
                      >
                        {deletingProductId === p.id ? "..." : "×"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <form className="add-product" onSubmit={handleCreateProduct}>
              <input
                value={newProductName}
                onChange={(e) => setNewProductName(e.target.value)}
                placeholder="Adicionar por nome exato..."
                aria-label="Nome do produto"
              />
              <button type="submit" disabled={creating} aria-label="Adicionar produto">
                {creating ? "..." : "+"}
              </button>
            </form>
            {createError && <p className="error">{createError}</p>}
          </div>

          {canManage && alerts.length > 0 && (
            <div className="panel">
              <h2>Alertas ativos</h2>
              <ul className="alert-list">
                {alerts.map((a) => (
                  <li key={a.id} className="alert-item">
                    <div className="alert-item-info">
                      <span className="alert-item-product">{a.tracked_product_id}</span>
                      <span className="alert-item-threshold">
                        abaixo de {a.currency} {Number(a.threshold_price).toFixed(2)}
                        {a.triggered && <span className="alert-badge">disparado</span>}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn-icon-danger"
                      onClick={() => handleDeleteAlert(a.id)}
                      aria-label={`Remover alerta de ${a.tracked_product_id}`}
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
          {!selectedProductId ? (
            <div className="detail-empty">
              <span className="detail-empty-icon" aria-hidden="true">📈</span>
              <p>Escolha um produto na lista ou busque um livro para começar a rastrear.</p>
            </div>
          ) : (
            <div className="card detail-card">
              {error && <p className="error">{error}</p>}

              {loading && <div className="skeleton skeleton--summary" aria-hidden="true" />}

              {!loading && history.length === 0 && (
                <p className="muted">⏳ Aguardando primeiro rastreamento pelo backend...</p>
              )}

              {latest && (
                <>
                  <div className="detail-head">
                    <div className="detail-head-info">
                      <p className="detail-eyebrow">{selectedProduct?.name ?? latest.title}</p>
                      <p className="price">
                        {latest.currency} {animatedPrice.toFixed(2)}
                        {deal.available && deal.tone === "success" && stats.isLowestEver && (
                          <span className="price-badge">Menor preço!</span>
                        )}
                      </p>
                      {discountPct > 0 && (
                        <p className="meta discount-line">
                          <span className="strike">
                            {latest.currency} {latest.fullPrice.toFixed(2)}
                          </span>
                          <span className="discount-pct">-{discountPct}%</span>
                        </p>
                      )}
                    </div>
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
                        <span>Menor · {latest.currency} {stats.min.toFixed(2)}</span>
                        <span>Maior · {latest.currency} {stats.max.toFixed(2)}</span>
                      </div>
                      <div className="position-track">
                        <div
                          className={`position-fill position-fill--${deal.tone}`}
                          style={{ width: `${Math.max(2, deal.positionPct)}%` }}
                        />
                        <div
                          className="position-marker"
                          style={{ left: `${deal.positionPct}%` }}
                          title={`Preço atual: ${latest.currency} ${latest.discountedPrice.toFixed(2)}`}
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
                        <span className="stat-value stat-value--low">
                          {latest.currency} {stats.min?.toFixed(2)}
                        </span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">Média</span>
                        <span className="stat-value">
                          {latest.currency} {stats.avg?.toFixed(2)}
                        </span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">Maior</span>
                        <span className="stat-value stat-value--high">
                          {latest.currency} {stats.max?.toFixed(2)}
                        </span>
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
                    <PriceChart data={viewHistory} />
                  </div>

                  <p className="meta detail-meta">
                    Atualizado em {new Date(latest.date).toLocaleString("pt-BR")}
                    {history.length > 1 && ` · ${history.length} registros`}
                    {" · "}
                    <a href={latest.url} target="_blank" rel="noreferrer">
                      Ver opções
                    </a>
                  </p>

                  {canManage && (
                    <form className="form alert-form" onSubmit={handleCreateAlert}>
                      <h3 className="alert-form-title">Alerta de preço</h3>
                      <div className="alert-field">
                        <label htmlFor="alert-threshold">Me avise quando cair abaixo de</label>
                        <div className="alert-controls">
                          <input
                            id="alert-threshold"
                            type="number"
                            step="0.01"
                            placeholder={(stats.avg ?? latest.discountedPrice).toFixed(2)}
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
