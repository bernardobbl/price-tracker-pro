import "dotenv/config";
import express from "express";
import cors from "cors";
import { scheduleDailyPriceJob } from "./jobs/scheduleDailyPriceJob";
import { getPriceHistory, trackAndStorePrice } from "./services/priceService";
import { createProduct, getProductById, listProducts } from "./services/productService";
import type { AuthenticatedRequest } from "./middleware/authMiddleware";
import { requireAuth } from "./middleware/authMiddleware";
import { createOrUpdateAlert, evaluateAlertImmediately, listAlertsByUser } from "./services/alertService";
import searchRouter from "./routes/searchRoute";

const app = express();
app.use(cors());
app.use(express.json());

// ── Rotas ──────────────────────────────────────────────────────────────────
app.use("/api/search", searchRouter);

const PORT = process.env.PORT || 4000;

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/products", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    const products = await listProducts(userId);
    res.json(products);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao listar produtos" });
  }
});

app.post("/api/products", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    const { id, name, searchQuery, marketplace } = req.body;

    if (!id || !name || !searchQuery) {
      return res.status(400).json({ error: "Campos obrigatórios: id, name, searchQuery" });
    }

    const existing = await getProductById(id, userId);
    if (existing) {
      return res.status(409).json({ error: "Já existe um produto com esse id" });
    }

    const product = await createProduct({ id, name, searchQuery, marketplace, userId });
    res.status(201).json(product);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao cadastrar produto" });
  }
});

app.post("/api/track/:productId", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    const { productId } = req.params;

    const product = await getProductById(productId, userId);
    if (!product) {
      return res.status(404).json({ error: "Produto não encontrado." });
    }

    const record = await trackAndStorePrice({
      id: product.id,
      name: product.name,
      searchQuery: product.searchQuery,
      marketplace: "mercado-livre",
      user_id: userId,
    });

    return res.status(201).json(record);
  } catch (error) {
    console.error("[/api/track] Erro ao rastrear preço:", error);
    res.status(500).json({ error: "Erro ao registrar preço" });
  }
});

app.get("/api/prices/:productId", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    const { productId } = req.params;
    const history = await getPriceHistory(productId, userId);
    res.json(history);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao buscar histórico de preços" });
  }
});

app.post("/api/alerts", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Usuário não autenticado" });

    const { productId, thresholdPrice, currency, channel, enabled, currentPrice, productName, productUrl } = req.body;

    if (!productId || typeof thresholdPrice !== "number") {
      return res.status(400).json({ error: "Campos obrigatórios: productId e thresholdPrice (number)" });
    }

    const alert = await createOrUpdateAlert({
      userId, productId, thresholdPrice, currency,
      channel: channel ?? "email", enabled,
    });

    const hasCurrentPrice =
      typeof currentPrice === "number" &&
      typeof productName === "string" &&
      typeof productUrl === "string";

    if (hasCurrentPrice && alert) {
      await evaluateAlertImmediately({
        alertId: alert.id, userId, productId, thresholdPrice,
        currentPrice, currency: currency ?? "R$", productName, productUrl,
      });
    }

    return res.status(201).json(alert);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erro ao criar/atualizar alerta" });
  }
});

app.get("/api/alerts", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Usuário não autenticado" });

    const alerts = await listAlertsByUser(userId);
    return res.json(alerts);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erro ao listar alertas" });
  }
});

app.listen(PORT, () => {
  console.log(`Backend rodando na porta ${PORT}`);
  scheduleDailyPriceJob();
});