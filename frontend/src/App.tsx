import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createProduct, fetchPriceHistory, fetchProducts, trackPriceNow } from "./api/client";
import type { PriceHistoryItem, TrackedProduct } from "./types";
import { PriceChart } from "./components/PriceChart";
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
  const [newProduct, setNewProduct] = useState({
    id: "",
    name: "",
    searchQuery: ""
  });
  const [alertThreshold, setAlertThreshold] = useState("");
  const [alertSaving, setAlertSaving] = useState(false);
  const [alertError, setAlertError] = useState<string | null>(null);
  const [alertSuccess, setAlertSuccess] = useState<string | null>(null);

  async function loadProductsAndMaybeSelect() {
    try {
      const list = await fetchProducts();
      setProducts(list);
      if (!selectedProductId && list.length > 0) {
        setSelectedProductId(list[0].id);
        void loadData(list[0].id, list);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao carregar produtos");
    }
  }

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

  async function loadData(id: string, currentProducts?: TrackedProduct[]) {
    try {
      setLoading(true);
      setError(null);
      let data = await fetchPriceHistory(id);

      // Se ainda não houver dados, dispara um rastreamento imediato e tenta de novo
      if (data.length === 0) {
        const productsList = currentProducts ?? products;
        const exists = productsList.some((p) => p.id === id);
        if (!exists) {
          throw new Error("Produto não está configurado para rastreamento");
        }

        await trackPriceNow(id);
        data = await fetchPriceHistory(id);
      }

      setHistory(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

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
  }, [user]);

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
    const id = newProduct.id.trim();
    const name = newProduct.name.trim();
    const searchQuery = newProduct.searchQuery.trim();

    if (!id || !name || !searchQuery) {
      setCreateError("Preencha id, nome e busca.");
      return;
    }

    try {
      setCreating(true);
      const created = await createProduct({
        id,
        name,
        searchQuery,
        marketplace: "mercado-livre"
      });
      const updatedProducts = [...products, created];
      setProducts(updatedProducts);
      setSelectedProductId(created.id);
      setNewProduct({ id: "", name: "", searchQuery: "" });
      await loadData(created.id, updatedProducts);
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
          enabled: true
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
              <div className="auth-row">
                <span className="meta">Logado como {user.email}</span>
                <button type="button" onClick={handleLogout}>
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
                ID (slug único):
                <input
                  value={newProduct.id}
                  onChange={(e) => setNewProduct((p) => ({ ...p, id: e.target.value }))}
                  placeholder="ps5, rtx-4070, iphone-15..."
                />
              </label>
              <label>
                Nome:
                <input
                  value={newProduct.name}
                  onChange={(e) => setNewProduct((p) => ({ ...p, name: e.target.value }))}
                  placeholder="PlayStation 5"
                />
              </label>
              <label>
                Termo de busca (Mercado Livre):
                <input
                  value={newProduct.searchQuery}
                  onChange={(e) =>
                    setNewProduct((p) => ({ ...p, searchQuery: e.target.value }))
                  }
                  placeholder="PlayStation 5 console"
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

      <footer className="footer">
        <span>
          Backend em <code>http://localhost:4000</code> — ajuste <code>VITE_API_BASE_URL</code> se
          necessário.
        </span>
      </footer>
    </div>
  );
}

export default App;

