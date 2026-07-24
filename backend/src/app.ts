import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import fuelRouter from "./routes/fuelRoute";
import fuelUserRouter from "./routes/fuelUserRoute";
import { errorHandler } from "./middleware/errorHandler";
import { sendError } from "./lib/httpError";

export const app = express();

// Atrás de um proxy (Render/Railway/Vercel) o IP real vem no X-Forwarded-For;
// necessário para o rate-limit contar por cliente, não pelo IP do proxy.
app.set("trust proxy", 1);

// Headers de segurança (CSP, HSTS, no-sniff, etc.). Como a API é JSON-only e
// consumida por outra origem, desligamos a CSP embutida (não serve HTML).
app.use(helmet({ contentSecurityPolicy: false }));

app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true,
}));
app.use(express.json());

// Rate-limit da API pública: protege o backend de abuso/scraping do próprio
// endpoint. Janela de 15 min, 300 req/IP (folgado para uso normal do dashboard).
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_req, res) =>
    sendError(res, 429, "RATE_LIMITED", "Muitas requisições. Tente novamente em instantes."),
});
app.use("/api", apiLimiter);

// ── Rotas ──────────────────────────────────────────────────────────────────
// Domínio combustível (ANP): consulta pública (fuelRouter) + favoritos/alertas
// autenticados (fuelUserRouter). Ambos montados sob /api/fuel.
app.use("/api/fuel", fuelRouter);
app.use("/api/fuel", fuelUserRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Error handler central (deve ser o último middleware)
app.use(errorHandler);
