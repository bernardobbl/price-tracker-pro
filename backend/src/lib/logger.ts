import pino from "pino";

/**
 * Logger estruturado da aplicação. Nível controlado por LOG_LEVEL (padrão "info").
 * Em produção emite JSON (fácil de indexar); em dev pode-se usar pino-pretty.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: undefined, // omite pid/hostname para logs mais limpos
  timestamp: pino.stdTimeFunctions.isoTime,
});
