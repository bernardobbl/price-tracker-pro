import cron from "node-cron";
import { trackAndStorePrice } from "../services/priceService";
import { listProducts } from "../services/productService";
import { scrapeMercadoLivrePrice } from "../scrapers/mercadoLivreScraper";

export function scheduleDailyPriceJob() {
  // Executa todo dia às 09:00 da manhã
  cron.schedule("0 9 * * *", async () => {
    console.log("[CRON] Rodando job diário de preços...");
    const products = await listProducts();

    for (const product of products) {
      try {
        const scraped = await scrapeMercadoLivrePrice(product.searchQuery);
        await trackAndStorePrice({
          ...product,
          marketplace: "mercado-livre",
          price: scraped.price,
          originalPrice: scraped.originalPrice,
          currency: scraped.currency,
          title: scraped.title,
          url: scraped.url,
        });
      } catch (error) {
        console.error(`[CRON] Erro ao rastrear ${product.id}`, error);
      }
    }
  });

  console.log("[CRON] Job diário agendado (0 9 * * *).");
}

