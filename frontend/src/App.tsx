import { useEffect, useState } from "react";
import { createProduct, fetchPriceHistory, fetchProducts, trackPriceNow } from "./api/client";
import type { PriceHistoryItem, TrackedProduct } from "./types";
import { PriceChart } from "./components/PriceChart";

function App() {
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
    void loadProductsAndMaybeSelect();
  }, []);

  const latest = history[history.length - 1];

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

  return (
    <div className="app">
      <header className="header">
        <h1>Price Tracker Pro</h1>
        <p>Dashboard simples de evolução de preço</p>
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
                <a href={latest.url} target="_blank" rel="noreferrer">
                  Ver anúncio
                </a>
              </p>
              <p className="title">{latest.title}</p>
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

