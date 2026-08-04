/**
 * Configuração do Mercado Pago, lida do ambiente uma única vez.
 *
 * A trava de ambiente aqui não é paranoia: o Access Token de **teste** e o de
 * **produção** começam ambos com `APP_USR` e são indistinguíveis a olho nu.
 * Sem uma bandeira explícita, os dois acidentes caros ficam fáceis:
 *
 *   • subir para produção com token de teste  → o cliente paga um QR que não cobra
 *   • rodar local com token de produção       → você cobra dinheiro de verdade sem querer
 *
 * Por isso `MERCADOPAGO_ENV` é obrigatória quando há token, e a combinação
 * perigosa (`NODE_ENV=production` + `MERCADOPAGO_ENV=test`) é recusada no boot.
 */

import { logger } from "../lib/logger";

export type MercadoPagoEnv = "test" | "production";

export interface MercadoPagoConfig {
  accessToken: string;
  publicKey: string | null;
  env: MercadoPagoEnv;
  /**
   * Segredo do webhook (painel → Webhooks).
   *
   * ⚠️ **AINDA NÃO É USADO.** A validação de assinatura (`x-signature`) não está
   * implementada — está anotada como pendência em `docs/proximos-passos.md`.
   *
   * Por que o sistema é seguro mesmo assim: a confirmação de um pagamento vem
   * de um GET **autenticado** na API do Mercado Pago, nunca do corpo da
   * notificação. Uma requisição forjada no webhook não libera acesso; ela só
   * faz o backend consultar uma order que não existe ou não está paga.
   *
   * O que a assinatura acrescentaria: barrar a forjaria **antes** da consulta,
   * evitando que alguém queime nosso limite de requisições na API do provedor.
   * É defesa em profundidade, não a diferença entre seguro e inseguro.
   *
   * Só dá para obter esse segredo depois de cadastrar a URL do webhook no
   * painel — o que exige URL pública. Por isso a ordem natural é: URL pública
   * → segredo → validação.
   */
  webhookSecret: string | null;
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";

/** Base da API. É a mesma URL para teste e produção — o que muda é o token. */
export const MERCADOPAGO_API = "https://api.mercadopago.com";

let cached: MercadoPagoConfig | null | undefined;

/**
 * Devolve a configuração, ou `null` quando o Mercado Pago não está configurado.
 *
 * `null` não é erro: o projeto roda inteiro sem pagamento (o checkout tem modo
 * demo). Quem depende disso trata a ausência explicitamente.
 */
export function getMercadoPagoConfig(): MercadoPagoConfig | null {
  if (cached !== undefined) return cached;

  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  const publicKey = process.env.MERCADOPAGO_PUBLIC_KEY?.trim() || null;
  const rawEnv = process.env.MERCADOPAGO_ENV?.trim().toLowerCase();
  const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim() || null;

  if (!accessToken || accessToken.startsWith("APP_USR-...")) {
    logger.warn(
      "[MercadoPago] MERCADOPAGO_ACCESS_TOKEN ausente — cobrança desligada (o app segue normal)."
    );
    cached = null;
    return cached;
  }

  if (rawEnv !== "test" && rawEnv !== "production") {
    logger.error(
      { valorRecebido: rawEnv ?? "(vazio)" },
      '[MercadoPago] MERCADOPAGO_ENV deve ser "test" ou "production" — cobrança desligada. ' +
        "Sem essa bandeira não dá para saber se o token cobra dinheiro real."
    );
    cached = null;
    return cached;
  }

  // A combinação que cobra de verdade quando você achava que estava testando —
  // ou o contrário. Falha fechado: melhor não cobrar do que cobrar errado.
  if (IS_PRODUCTION && rawEnv === "test") {
    logger.error(
      "[MercadoPago] NODE_ENV=production com MERCADOPAGO_ENV=test — cobrança desligada. " +
        "Em produção o cliente pagaria um QR que não cobra nada."
    );
    cached = null;
    return cached;
  }

  if (!IS_PRODUCTION && rawEnv === "production") {
    // Não bloqueia (pode ser um teste deliberado de smoke), mas grita no log.
    logger.warn(
      "[MercadoPago] ⚠️ AMBIENTE LOCAL COM TOKEN DE PRODUÇÃO — cobranças criadas aqui são REAIS."
    );
  }

  cached = { accessToken, publicKey, env: rawEnv, webhookSecret };

  logger.info(
    {
      env: cached.env,
      temPublicKey: Boolean(publicKey),
      // Deliberadamente NÃO logamos "temWebhookSecret: true": o segredo é lido
      // mas ainda não valida nada, e anunciar isso sugeriria uma proteção que
      // não existe. O aviso abaixo é a informação honesta.
      validacaoDeAssinaturaDoWebhook: "NÃO IMPLEMENTADA",
    },
    "[MercadoPago] Configurado"
  );

  return cached;
}

/** Só para testes: força releitura do ambiente. */
export function __resetMercadoPagoConfig() {
  cached = undefined;
}

/** Atalho: a cobrança está ligada? */
export function isBillingEnabled(): boolean {
  return getMercadoPagoConfig() !== null;
}
