import "dotenv/config";
import express from "express";
import cors from "cors";
import { scheduleDailyPriceJob } from "./jobs/scheduleDailyPriceJob";
import { getPriceHistory, trackAndStorePrice } from "./services/priceService";
import { createProduct, getProductById, listProducts } from "./services/productService";
import type { AuthenticatedRequest } from "./middleware/authMiddleware";
import { requireAuth } from "./middleware/authMiddleware";
import { createOrUpdateAlert, listAlertsByUser } from "./services/alertService";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Lista todos os produtos configurados para rastreamento
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

// Cadastra um novo produto para rastreamento
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

// Dispara rastreamento imediato de um produto configurado
app.post("/api/track/:productId", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    const { productId } = req.params;
    const product = await getProductById(productId, userId);

    if (!product) {
      return res.status(404).json({ error: "Produto não configurado para rastreamento" });
    }

    const record = await trackAndStorePrice(product);
    res.status(201).json(record);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao rastrear preço" });
  }
});

// Retorna histórico de preços para um produto
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

// Cria ou atualiza alerta para um produto
app.post("/api/alerts", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { productId, thresholdPrice, currency, channel, enabled } = req.body;

    if (!productId || typeof thresholdPrice !== "number") {
      return res
        .status(400)
        .json({ error: "Campos obrigatórios: productId e thresholdPrice (number)" });
    }

    const alert = await createOrUpdateAlert({
      userId,
      productId,
      thresholdPrice,
      currency,
      // por enquanto só suportamos email
      channel: channel ?? "email",
      enabled
    });

    return res.status(201).json(alert);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erro ao criar/atualizar alerta" });
  }
});

// Lista alertas do usuário autenticado
app.get("/api/alerts", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

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

