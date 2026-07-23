import express from "express";
import cors from "cors";
import fuelRouter from "./routes/fuelRoute";
import fuelUserRouter from "./routes/fuelUserRoute";
import { errorHandler } from "./middleware/errorHandler";

export const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true,
}));
app.use(express.json());

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
