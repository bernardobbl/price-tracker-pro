import cron from "node-cron";
import { trackAndStorePrice } from "../services/priceService";
import { listProducts } from "../services/productService";
import { scrapeBookPrice } from "../scrapers/booksToScrapeScraper";
import { sleep } from "../scrapers/httpClient";
import { logger } from "../lib/logger";

// Intervalo entre produtos no job diário, para não sobrecarregar a fonte.
const DELAY_BETWEEN_PRODUCTS_MS = 2_000;

export function scheduleDailyPriceJob() {
  // Executa todo dia às 09:00 da manhã
  cron.schedule("0 9 * * *", async () => {
    logger.info("[CRON] Rodando job diário de preços...");
    const products = await listProducts();

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      try {
        const scraped = await scrapeBookPrice(product.searchQuery);
        await trackAndStorePrice({
          ...product,
          marketplace: "books-to-scrape",
          price: scraped.price,
          originalPrice: scraped.originalPrice,
          currency: scraped.currency,
          title: scraped.title,
          url: scraped.url,
        });
      } catch (error) {
        logger.error({ err: error }, `[CRON] Erro ao rastrear ${product.id}`);
      }

      // Rate-limit: aguarda entre produtos (menos no último).
      if (i < products.length - 1) {
        await sleep(DELAY_BETWEEN_PRODUCTS_MS);
      }
    }
  });

  logger.info("[CRON] Job diário agendado (0 9 * * *).");
}

