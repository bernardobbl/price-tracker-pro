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
 * A origem **pública** do app — a que vai dentro de um e-mail.
 *
 * ## O bug que isto evita
 *
 * `FRONTEND_URL` aceita uma lista separada por vírgula, e três lugares do
 * backend jogavam o valor **cru** dentro do texto de e-mails: o alerta de
 * preço, o aviso de vencimento e o comprovante de pagamento. No dia em que essa
 * variável ganhar uma segunda origem — coisa que o próprio `.env.example`
 * mostra como exemplo, e que basta um preview da Vercel para acontecer — todo
 * link enviado vira isto:
 *
 *     https://app.vercel.app,http://localhost:5173/premium
 *
 * Um link quebrado num alerta é irritante. Num comprovante de pagamento, é a
 * pessoa que acabou de pagar clicando e não chegando a lugar nenhum.
 *
 * ## Por que a primeira, e não a mais longa ou a "que parece produção"
 *
 * Porque é a única regra que dá para escrever no `.env.example` e alguém
 * seguir: **a primeira é a principal**. Qualquer heurística mais esperta
 * (ignorar localhost, preferir https) acerta hoje e erra no dia em que a
 * configuração mudar por um motivo que ninguém previu.
 */
export function publicAppUrl(raw: string | undefined): string {
  return parseAllowedOrigins(raw)[0] ?? DEFAULT_ORIGIN;
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
