import "dotenv/config";
import { app } from "./app";
import { scheduleWeeklyAnpJob } from "./jobs/scheduleWeeklyAnpJob";
import { getMercadoPagoConfig } from "./config/mercadoPago";
import { logger } from "./lib/logger";

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  logger.info(`Backend rodando na porta ${PORT}`);

  // Força a leitura da configuração de pagamento AGORA, só pelo log.
  //
  // Ela é preguiçosa e cacheada: sem esta linha, `[MercadoPago] Configurado`
  // só sairia na **primeira requisição de cobrança** — ou seja, você
  // descobriria que subiu com o token errado quando o primeiro cliente
  // tentasse pagar, não quando o deploy terminou. Configuração de dinheiro é
  // exatamente o tipo de coisa que se quer conferir no minuto do deploy.
  //
  // A chamada é barata (lê variáveis de ambiente) e o resultado fica em cache,
  // então ela não custa nada às requisições seguintes. E quando a cobrança está
  // desligada, o próprio `getMercadoPagoConfig` já grita o motivo no log.
  getMercadoPagoConfig();

  scheduleWeeklyAnpJob();
});
