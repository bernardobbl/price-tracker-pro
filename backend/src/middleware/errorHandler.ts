import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";
import { ScrapeError } from "../scrapers/httpClient";

/** Safety net: captura qualquer erro não tratado e responde no formato padrão. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ScrapeError) {
    const status = err.code === "PRICE_NOT_FOUND" ? 404 : 502;
    return res.status(status).json({ error: { code: err.code, message: err.message } });
  }

  logger.error({ err }, "Erro não tratado");
  return res
    .status(500)
    .json({ error: { code: "INTERNAL_ERROR", message: "Erro interno do servidor." } });
}
