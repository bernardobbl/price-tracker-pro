import "dotenv/config";
import { app } from "./app";
import { scheduleWeeklyAnpJob } from "./jobs/scheduleWeeklyAnpJob";
import { logger } from "./lib/logger";

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  logger.info(`Backend rodando na porta ${PORT}`);
  scheduleWeeklyAnpJob();
});
