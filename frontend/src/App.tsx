import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createProduct, fetchPriceHistory, fetchProducts, trackPriceNow } from "./api/client";
import type { PriceHistoryItem, TrackedProduct } from "./types";
import { PriceChart } from "./components/PriceChart";
import { supabase } from "./supabaseClient";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

interface SearchResultItem {
  title: string;
  url: string;
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
      const res = await fetch(`${API_BASE_URL}/api/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error("Erro ao buscar produtos");
      const data: SearchResultItem[] = await res.json();
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
  }, [products]);

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

    void (async () => {
      const { data } = await supabase.auth.getSession();
      setUser(data.session?.user ?? null);
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
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

      const {
        data: { session }
      } = await supabase.auth.getSession();

      const token = session?.access_token;
      if (!token) {
        setAlertError("Sessão expirada. Faça login novamente.");
        return;
      }

      const response = await fetch(`${API_BASE_URL}/api/alerts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          productId: selectedProductId,
          thresholdPrice: numericThreshold,
          currency: latest.currency,
          channel: "email",
          enabled: true,
          currentPrice: latest.discountedPrice,
          productName: latest.title,
          productUrl: latest.url
        })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Erro ao salvar alerta");
      }

      setAlertSuccess("Alerta salvo com sucesso! Você será avisado por email.");
    } catch (err: unknown) {
      setAlertError(err instanceof Error ? err.message : "Erro ao salvar alerta");
    } finally {
      setAlertSaving(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Price Tracker Pro</h1>
        <p>Dashboard simples de evolução de preço</p>
        {supabase && (
          <div className="auth-panel">
            {authLoading ? (
              <p className="muted">Verificando sessão...</p>
            ) : user ? (
              <div className="auth-row auth-row--logged">
                <span className="auth-email">👤 {user.email}</span>
                <button type="button" className="btn-logout" onClick={handleLogout}>
                  Sair
                </button>
              </div>
            ) : (
              <form className="auth-form" onSubmit={handleAuthSubmit}>
                <div className="auth-row">
                  <input
                    type="email"
                    placeholder="Seu email"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                  />
                  <input
                    type="password"
                    placeholder="Senha"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                  />
                </div>
                <div className="auth-row" style={{ marginTop: "0.5rem" }}>
                  <button type="submit" disabled={authSubmitting}>
                    {authSubmitting
                      ? "Enviando..."
                      : authMode === "login"
                        ? "Entrar"
                        : "Cadastrar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthMode((mode) => (mode === "login" ? "signup" : "login"))}
                  >
                    {authMode === "login" ? "Criar conta" : "Já tenho conta"}
                  </button>
                </div>
                {authError && (
                  <p className="error" style={{ marginTop: "0.5rem" }}>
                    {authError}
                  </p>
                )}
              </form>
            )}
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
              <h2>Último preço</h2>
              <p className="price">
                {latest.currency} {latest.discountedPrice.toFixed(2)}
              </p>
              {latest.fullPrice > latest.discountedPrice && (
                <p className="meta">
                  <span style={{ textDecoration: "line-through", marginRight: "0.5rem" }}>
                    {latest.currency} {latest.fullPrice.toFixed(2)}
                  </span>
                  <span style={{ color: "#f97316", fontWeight: 600 }}>
                    -
                    {Math.round(
                      (1 - latest.discountedPrice / latest.fullPrice) * 100
                    )}
                    %
                  </span>
                </p>
              )}
              <p className="meta">
                {new Date(latest.date).toLocaleString("pt-BR")} •{" "}
                <a href={listingUrl ?? latest.url} target="_blank" rel="noreferrer">
                  Ver opções
                </a>
              </p>
              <p className="title">{latest.title}</p>
              {supabase && user && (
                <form className="form" onSubmit={handleCreateAlert} style={{ marginTop: "1rem" }}>
                  <h3>Sistema de alerta</h3>
                  <p className="meta">
                    2️⃣ Se o preço cair abaixo de X valor, te avisamos por email.
                  </p>
                  <div className="alert-row">
                    <label>
                      Me avise quando ficar abaixo de:
                      <input
                        type="number"
                        step="0.01"
                        placeholder={latest.discountedPrice.toFixed(2)}
                        value={alertThreshold}
                        onChange={(e) => setAlertThreshold(e.target.value)}
                      />
                    </label>
                    <button type="submit" disabled={alertSaving}>
                      {alertSaving ? "Salvando alerta..." : "Ativar alerta"}
                    </button>
                  </div>
                  {alertError && <p className="error">{alertError}</p>}
                  {alertSuccess && <p className="success">{alertSuccess}</p>}
                </form>
              )}
            </div>
          )}

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