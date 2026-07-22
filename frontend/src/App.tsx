import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  createAlert,
  createProduct,
  fetchPriceHistory,
  fetchProducts,
  searchProducts,
  trackPriceNow,
  type SearchResultItem
} from "./api/client";
import type { PriceHistoryItem, TrackedProduct } from "./types";
import { PriceChart } from "./components/PriceChart";
import { computePriceStats } from "./lib/priceStats";
import { supabase } from "./supabaseClient";

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
  const [alertSuccess, setAlertSuccess] = useState<string | null>(null);

  // ── Busca livre ──────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearchLoading(true);
    setSearchError(null);
    setSearchResults([]);
    try {
      const data = await searchProducts(q);
      setSearchResults(data);
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : "Erro inesperado na busca");
    } finally {
      setSearchLoading(false);
    }
  };
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

  const latest = history[history.length - 1];
  const stats = computePriceStats(history);
  const selectedProduct = products.find((p) => p.id === selectedProductId);
  const listingUrl =
    selectedProduct?.marketplace === "mercado-livre"
      ? `https://lista.mercadolivre.com.br/${encodeURIComponent(selectedProduct.searchQuery)}`
      : latest?.url;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = selectedProductId.trim();
    if (!trimmed) return;
    void loadData(trimmed);
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    const name = newProductName.trim();
    if (!name) {
      setCreateError("Digite o nome do produto.");
      return;
    }
    // Gera ID automático: "PlayStation 5" → "playstation-5"
    const id = name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    try {
      setCreating(true);
      const created = await createProduct({ id, name, searchQuery: name, marketplace: "mercado-livre" });
      const updatedProducts = [...products, created];
      setProducts(updatedProducts);
      setSelectedProductId(created.id);
      setNewProductName("");
      // Dispara scraping imediato no backend
      await trackPriceNow(created.id);
      await loadData(created.id);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Erro ao cadastrar produto");
    } finally {
      setCreating(false);
    }
  };

  const handleCreateAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    setAlertError(null);
    setAlertSuccess(null);

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

      setAlertSuccess("Alerta salvo com sucesso! Você será avisado por email.");
    } catch (err: unknown) {
      setAlertError(err instanceof Error ? err.message : "Erro ao salvar alerta");
    } finally {
      setAlertSaving(false);
    }
  };

  // Tela de loading
  if (authLoading) {
    return (
      <div className="app">
        <div className="auth-loading">Verificando sessão...</div>
      </div>
    );
  }

  // Tela de login (quando não autenticado e Supabase está ativo)
  if (supabase && !user) {
    return (
      <div className="app">
        <header className="header">
          <div className="header-brand">
            <h1>Price Tracker Pro</h1>
            <p>Monitore preços do Mercado Livre</p>
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
          <h1>Price Tracker Pro</h1>
          <p>Monitore preços do Mercado Livre</p>
        </div>
        {supabase && user && (
          <div className="auth-row auth-row--logged">
            <span className="auth-email">👤 {user.email}</span>
            <button type="button" className="btn-logout" onClick={handleLogout}>
              Sair
            </button>
          </div>
        )}
      </header>

      <main className="content">
        <section className="card">
          <form className="form" onSubmit={handleSubmit}>
            <label>
              Produto:
              <select
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
              >
                <option value="">Selecione um produto</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.id})
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={loading || !selectedProductId}>
              {loading ? "Carregando..." : "Buscar histórico"}
            </button>
          </form>

          {error && <p className="error">{error}</p>}

          {!loading && selectedProductId && history.length === 0 && (
            <p className="muted" style={{ marginTop: "1rem" }}>
              ⏳ Aguardando primeiro rastreamento pelo backend...
            </p>
          )}

          {latest && (
            <div className="summary">
              <h2>Preço atual</h2>
              <p className="price">
                {latest.currency} {latest.discountedPrice.toFixed(2)}
                {stats.isLowestEver && history.length > 1 && (
                  <span className="price-badge">Menor preço!</span>
                )}
              </p>

              {latest.fullPrice > latest.discountedPrice && (
                <p className="meta" style={{ marginTop: "0.25rem" }}>
                  <span style={{ textDecoration: "line-through", marginRight: "0.5rem" }}>
                    {latest.currency} {latest.fullPrice.toFixed(2)}
                  </span>
                  <span style={{ color: "#f97316", fontWeight: 600 }}>
                    -{Math.round((1 - latest.discountedPrice / latest.fullPrice) * 100)}%
                  </span>
                </p>
              )}

              {history.length > 1 && (
                <div className="stat-grid">
                  <div className="stat">
                    <span className="stat-label">Menor</span>
                    <span className="stat-value stat-value--low">
                      {latest.currency} {stats.min?.toFixed(2)}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Médio</span>
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
                </div>
              )}

              <p className="meta" style={{ marginTop: "0.75rem" }}>
                Atualizado em {new Date(latest.date).toLocaleString("pt-BR")}
                {history.length > 1 && ` · ${history.length} registros`}
                {" · "}
                <a href={listingUrl ?? latest.url} target="_blank" rel="noreferrer">
                  Ver opções
                </a>
              </p>
              <p className="title">{latest.title}</p>

              {supabase && user && (
                <form className="form" onSubmit={handleCreateAlert} style={{ marginTop: "1.25rem" }}>
                  <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem", color: "#94a3b8" }}>
                    Alerta de preço
                  </h3>
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
                  {alertSuccess && <p className="success">{alertSuccess}</p>}
                </form>
              )}
            </div>
          )}

          <div className="summary" style={{ marginTop: "1.5rem" }}>
            <h2>Buscar produto</h2>
            <form className="form" onSubmit={handleSearch}>
              <label>
                Pesquisar no Mercado Livre:
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Ex: PlayStation 5, iPhone 15..."
                />
              </label>
              <button type="submit" disabled={searchLoading || !searchQuery.trim()}>
                {searchLoading ? "Buscando..." : "Buscar"}
              </button>
            </form>
            {searchError && <p className="error">{searchError}</p>}
            {searchResults.length > 0 && (
              <ul className="search-results">
                {searchResults.map((item, i) => (
                  <li key={i}>
                    <a href={item.url} target="_blank" rel="noreferrer">
                      {item.title}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="summary" style={{ marginTop: "1.5rem" }}>
            <h2>Cadastrar novo produto</h2>
            <form className="form" onSubmit={handleCreateProduct}>
              <label>
                Nome do produto:
                <input
                  value={newProductName}
                  onChange={(e) => setNewProductName(e.target.value)}
                  placeholder="Ex: PlayStation 5, iPhone 15, RTX 4070..."
                />
              </label>
              <button type="submit" disabled={creating}>
                {creating ? "Salvando..." : "Cadastrar e rastrear"}
              </button>
            </form>
            {createError && <p className="error">{createError}</p>}
          </div>
        </section>

        <section className="card">
          <h2>Evolução de preço</h2>
          <PriceChart data={history} />
        </section>
      </main>

    </div>
  );
}

export default App;