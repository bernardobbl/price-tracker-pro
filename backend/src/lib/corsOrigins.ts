/**
 * Origens liberadas no CORS — lógica pura (testável, sem depender do env).
 *
 * Em produção o frontend costuma ter mais de uma origem legítima: o domínio
 * principal, os *preview deploys* da Vercel e o localhost durante o debug. Por isso
 * `FRONTEND_URL` aceita uma **lista separada por vírgula**.
 *
 * A comparação do CORS é por **string exata**, então normalizamos: `trim` + remoção
 * da barra final. Sem isso, um `FRONTEND_URL=https://app.vercel.app/` (com barra,
 * como a Vercel mostra na UI) nunca casaria com o header `Origin`, que o navegador
 * envia sem barra — e o deploy quebraria com um erro de CORS difícil de diagnosticar.
 */

export const DEFAULT_ORIGIN = "http://localhost:5173";

/** Normaliza uma origem: sem espaços em volta, sem barra(s) final(is). */
export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

/** Converte o valor cru de `FRONTEND_URL` na lista de origens permitidas. */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  const value = raw?.trim() ? raw : DEFAULT_ORIGIN;
  return value.split(",").map(normalizeOrigin).filter(Boolean);
}

/**
 * Decide se uma origem pode ser aceita.
 * `undefined` = requisição sem header `Origin` (curl, healthcheck, same-origin,
 * app mobile) — o CORS não se aplica, então liberamos.
 */
export function isOriginAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return true;
  return allowed.includes(normalizeOrigin(origin));
}
