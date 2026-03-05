import { Router } from "express";
import type { Request, Response } from "express";
import axios from "axios";

const router = Router();

interface MercadoLivreApiItem {
  title: string;
  permalink: string;
}

interface MercadoLivreSearchResponse {
  results: MercadoLivreApiItem[];
}

router.get("/", async (req: Request, res: Response) => {
  const q = (req.query.q as string)?.trim();

  if (!q) {
    return res.status(400).json({ error: "Parâmetro 'q' é obrigatório." });
  }

  try {
    const response = await axios.get<MercadoLivreSearchResponse>(
      "https://api.mercadolibre.com/sites/MLB/search",
      {
        params: { q, limit: 10 },
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
          Accept: "application/json"
        },
        timeout: 10000
      }
    );

    const results = (response.data.results ?? []).map((item) => ({    title: item.title,
      url: item.permalink
    }));

    return res.json(results);
  } catch (err) {
    console.error("[Search] Erro ao buscar no Mercado Livre:", err);
    return res.status(500).json({ error: "Erro ao buscar produtos." });
  }
});

export default router;
