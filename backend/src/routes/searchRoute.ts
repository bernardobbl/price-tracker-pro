import { Router } from "express";
import { searchMercadoLivre } from "../scrapers/mercadoLivreScraper";
import { asyncHandler } from "../lib/asyncHandler";
import { validate } from "../middleware/validate";
import { searchQuerySchema } from "../schemas/requestSchemas";

const router = Router();

router.get(
  "/",
  validate(searchQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const q = req.query.q as string;
    // Erros de scraping (ScrapeError) são tratados pelo errorHandler central.
    const results = await searchMercadoLivre(q, 10);
    res.json(results);
  })
);

export default router;
