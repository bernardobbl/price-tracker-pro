/**
 * Rotas de consulta do domínio combustível (ANP) — dado público, leitura.
 *   GET /api/fuel/products                          → produtos disponíveis
 *   GET /api/fuel/locations[?state=UF]              → UFs, ou municípios de uma UF
 *   GET /api/fuel/series?product=&state=&municipality=   → série agregada (média/mín/máx por data)
 *   GET /api/fuel/snapshot?product=&state=&municipality= → levantamento mais recente + ranking de postos
 */

import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { validate } from "../middleware/validate";
import { fuelLocationsQuerySchema, fuelSeriesQuerySchema } from "../schemas/requestSchemas";
import {
  getFuelSeries,
  getSnapshot,
  listMunicipalities,
  listProducts,
  listStates,
} from "../services/fuelQueryService";

const router = Router();

router.get(
  "/products",
  asyncHandler(async (_req, res) => {
    res.json(listProducts());
  })
);

router.get(
  "/locations",
  validate(fuelLocationsQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const state = req.query.state as string | undefined;
    if (state) {
      res.json({ state, municipalities: await listMunicipalities(state) });
    } else {
      res.json({ states: await listStates() });
    }
  })
);

router.get(
  "/series",
  validate(fuelSeriesQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const { product, state, municipality, brand } = req.query as Record<string, string>;
    res.json(await getFuelSeries(product, state, municipality, brand));
  })
);

router.get(
  "/snapshot",
  validate(fuelSeriesQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const { product, state, municipality, brand } = req.query as Record<string, string>;
    res.json(await getSnapshot(product, state, municipality, brand));
  })
);

export default router;
