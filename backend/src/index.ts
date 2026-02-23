import "dotenv/config";
import express from "express";
import cors from "cors";
import { scheduleDailyPriceJob } from "./jobs/scheduleDailyPriceJob";
import { getPriceHistory, trackAndStorePrice } from "./services/priceService";
import { createProduct, getProductById, listProducts } from "./services/productService";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Lista todos os produtos configurados para rastreamento
app.get("/api/products", async (_req, res) => {
  try {
    const products = await listProducts();
    res.json(products);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao listar produtos" });
  }
});

// Cadastra um novo produto para rastreamento
app.post("/api/products", async (req, res) => {
  try {
    const { id, name, searchQuery, marketplace } = req.body;

    if (!id || !name || !searchQuery) {
      return res.status(400).json({ error: "Campos obrigatórios: id, name, searchQuery" });
    }

    const existing = await getProductById(id);
    if (existing) {
      return res.status(409).json({ error: "Já existe um produto com esse id" });
    }

    const product = await createProduct({ id, name, searchQuery, marketplace });
    res.status(201).json(product);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao cadastrar produto" });
  }
});

// Dispara rastreamento imediato de um produto configurado
app.post("/api/track/:productId", async (req, res) => {
  try {
    const { productId } = req.params;
    const product = await getProductById(productId);

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
app.get("/api/prices/:productId", async (req, res) => {
  try {
    const { productId } = req.params;
    const history = await getPriceHistory(productId);
    res.json(history);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao buscar histórico de preços" });
  }
});

app.listen(PORT, () => {
  console.log(`Backend rodando na porta ${PORT}`);
  scheduleDailyPriceJob();
});

