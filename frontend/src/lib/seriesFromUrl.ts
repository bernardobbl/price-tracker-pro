/**
 * Série vinda da URL (`/?produto=GASOLINA&uf=SP&municipio=SAO%20PAULO`).
 *
 * Existe para o link do email de alerta abrir **a série do alerta**, e não a home
 * genérica. Também torna qualquer consulta compartilhável por link — copiar a URL
 * e mandar para alguém passa a funcionar.
 *
 * Parâmetros em português para casar com a interface. Ausentes ou incompletos →
 * `null`, e o app cai na série padrão de sempre.
 */

export interface SeriePorUrl {
  product: string;
  state: string;
  municipality: string;
  brand: string | null;
}

/**
 * Lê os parâmetros de uma query string. Não valida se a série existe no banco —
 * quem chama decide o que fazer se a busca não retornar nada.
 */
export function lerSerieDaUrl(search: string): SeriePorUrl | null {
  const params = new URLSearchParams(search);

  const product = params.get("produto")?.trim().toUpperCase();
  const state = params.get("uf")?.trim().toUpperCase();
  const municipality = params.get("municipio")?.trim().toUpperCase();

  if (!product || !state || !municipality) return null;
  // UF é sempre de 2 letras; barra cedo entrada malformada.
  if (state.length !== 2) return null;

  const brand = params.get("bandeira")?.trim().toUpperCase();

  return { product, state, municipality, brand: brand || null };
}
