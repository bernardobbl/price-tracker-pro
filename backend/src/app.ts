import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import fuelRouter from "./routes/fuelRoute";
import fuelUserRouter from "./routes/fuelUserRoute";
import billingRouter from "./routes/billingRoute";
import accountRouter from "./routes/accountRoute";
import { errorHandler } from "./middleware/errorHandler";
import { sendError } from "./lib/httpError";
import { isOriginAllowed, parseAllowedOrigins } from "./lib/corsOrigins";

export const app = express();

// Atrás de um proxy (Render/Railway/Vercel) o IP real vem no X-Forwarded-For;
// necessário para o rate-limit contar por cliente, não pelo IP do proxy.
app.set("trust proxy", 1);

// Headers de segurança (CSP, HSTS, no-sniff, etc.). Como a API é JSON-only e
// consumida por outra origem, desligamos a CSP embutida (não serve HTML).
app.use(helmet({ contentSecurityPolicy: false }));

// CORS: `FRONTEND_URL` aceita **uma ou várias** origens separadas por vírgula
// (domínio de produção + previews da Vercel + localhost). Regras puras e testadas
// em `lib/corsOrigins.ts` — inclusive a normalização da barra final, que é a causa
// clássica de "funciona local, quebra no deploy".
export const allowedOrigins = parseAllowedOrigins(process.env.FRONTEND_URL);

app.use(cors({
  origin: (origin, callback) =>
    // Não lançamos erro para origem desconhecida: responder sem os headers de CORS
    // já faz o navegador bloquear, e um throw viraria 500 no log a cada requisição
    // (ruído + vetor de log-flood).
    callback(null, isOriginAllowed(origin, allowedOrigins)),
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
// O webhook do Mercado Pago fica FORA do limitador. Um 429 devolvido a ele não
// descarta a notificação: ele reenvia em backoff — ou seja, o limite geraria
// mais tráfego, não menos, e ainda atrasaria a liberação de quem pagou. A porta
// segue segura porque o corpo da notificação não é confiado (a confirmação vem
// de um GET autenticado na API), então inundá-la não libera acesso a ninguém.
app.use("/api", (req, res, next) => {
  if (req.path === "/billing/webhook") return next();
  return apiLimiter(req, res, next);
});

// ── Rotas ──────────────────────────────────────────────────────────────────
// Domínio combustível (ANP): consulta pública (fuelRouter) + favoritos/alertas
// autenticados (fuelUserRouter). Ambos montados sob /api/fuel.
app.use("/api/fuel", fuelRouter);
app.use("/api/fuel", fuelUserRouter);

// Cobrança e assinatura. O /webhook aqui dentro é público por natureza (quem
// chama é o Mercado Pago) — a proteção está em não confiar no corpo recebido.
app.use("/api/billing", billingRouter);

// Direitos do titular (LGPD art. 18): exportar os próprios dados e excluir a
// conta. Sempre sobre o usuário do token — não existe id de terceiro aqui.
app.use("/api/account", accountRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Error handler central (deve ser o último middleware)
app.use(errorHandler);
