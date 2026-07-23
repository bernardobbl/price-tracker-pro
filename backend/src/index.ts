import "dotenv/config";
import { app } from "./app";
import { scheduleWeeklyAnpJob } from "./jobs/scheduleWeeklyAnpJob";
import { logger } from "./lib/logger";

// Nota (migração de domínio — Fase 6.8): o antigo `scheduleDailyPriceJob` (scraping
// de livros no Books to Scrape) consulta `tracked_products`, tabela aposentada pela
// migração para o domínio combustível. Por isso não é mais agendado no boot. O arquivo
// permanece no repositório para o histórico/git até a limpeza formal (Fase 6.8 · J4).

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  logger.info(`Backend rodando na porta ${PORT}`);
  scheduleWeeklyAnpJob();
});
