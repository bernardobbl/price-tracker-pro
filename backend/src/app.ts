import express from "express";
import cors from "cors";
import { getPriceHistory, trackAndStorePrice } from "./services/priceService";
import { createProduct, getProductById, listProducts } from "./services/productService";
import type { AuthenticatedRequest } from "./middleware/authMiddleware";
import { requireAuth } from "./middleware/authMiddleware";
import { createOrUpdateAlert, evaluateAlertImmediately, listAlertsByUser } from "./services/alertService";
import searchRouter from "./routes/searchRoute";
import { scrapeMercadoLivrePrice } from "./scrapers/mercadoLivreScraper";
import { asyncHandler } from "./lib/asyncHandler";
import { sendError } from "./lib/httpError";
import { validate } from "./middleware/validate";
import { errorHandler } from "./middleware/errorHandler";
import {
  createAlertSchema,
  createProductSchema,
  productParamsSchema,
  trackParamsSchema,
} from "./schemas/requestSchemas";

export const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true,
}));
app.use(express.json());

// ── Rotas ──────────────────────────────────────────────────────────────────
app.use("/api/search", searchRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get(
  "/api/products",
  requireAuth,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const products = await listProducts(req.user?.id);
    res.json(products);
  })
);

app.post(
  "/api/products",
  requireAuth,
  validate(createProductSchema),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = req.user?.id;
    const { id, name, searchQuery, marketplace } = req.body;

    const existing = await getProductById(id, userId);
    if (existing) {
      return sendError(res, 409, "PRODUCT_EXISTS", "Já existe um produto com esse id.");
    }

    const product = await createProduct({ id, name, searchQuery, marketplace, userId });
    return res.status(201).json(product);
  })
);

app.post(
  "/api/track/:productId",
  requireAuth,
  validate(trackParamsSchema, "params"),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = req.user?.id;
    const { productId } = req.params;

    const product = await getProductById(productId, userId);
    if (!product) {
      return sendError(res, 404, "PRODUCT_NOT_FOUND", "Produto não encontrado.");
    }

    // Erros de scraping (ScrapeError) são mapeados pelo errorHandler central.
    const scraped = await scrapeMercadoLivrePrice(product.searchQuery);

    const record = await trackAndStorePrice({
      id: product.id,
      name: product.name,
      searchQuery: product.searchQuery,
      marketplace: "mercado-livre",
      user_id: userId,
      price: scraped.price,
      originalPrice: scraped.originalPrice,
      currency: scraped.currency,
      title: scraped.title,
      url: scraped.url,
    });

    return res.status(201).json(record);
  })
);

app.get(
  "/api/prices/:productId",
  requireAuth,
  validate(productParamsSchema, "params"),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const history = await getPriceHistory(req.params.productId, req.user?.id);
    res.json(history);
  })
);

app.post(
  "/api/alerts",
  requireAuth,
  validate(createAlertSchema),
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return sendError(res, 401, "UNAUTHENTICATED", "Usuário não autenticado.");

    const { productId, thresholdPrice, currency, channel, enabled, currentPrice, productName, productUrl } = req.body;

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
  })
);

app.get(
  "/api/alerts",
  requireAuth,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return sendError(res, 401, "UNAUTHENTICATED", "Usuário não autenticado.");

    const alerts = await listAlertsByUser(userId);
    return res.json(alerts);
  })
);

// Error handler central (deve ser o último middleware)
app.use(errorHandler);
