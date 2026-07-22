import { Router } from "express";
import type { Request, Response } from "express";
import { searchMercadoLivre } from "../scrapers/mercadoLivreScraper";
import { ScrapeError } from "../scrapers/httpClient";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  const q = (req.query.q as string)?.trim();

  if (!q) {
    return res.status(400).json({ error: "Parâmetro 'q' é obrigatório." });
  }

  try {
    const results = await searchMercadoLivre(q, 10);
    return res.json(results);
  } catch (err) {
    console.error("[Search] Erro ao buscar no Mercado Livre:", err);
    if (err instanceof ScrapeError) {
      return res.status(502).json({ error: "Não foi possível consultar o Mercado Livre agora. Tente novamente em instantes." });
    }
    return res.status(500).json({ error: "Erro ao buscar produtos." });
  }
});

export default router;
