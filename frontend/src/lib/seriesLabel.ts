/**
 * Rótulo/apresentação de uma série de combustível (puro, testável).
 * Espelha o `buildSeriesLabel` do backend para os casos em que o front
 * precisa exibir um recorte ainda não persistido (exploração ad-hoc).
 *
 * Ex.: ("GASOLINA", "SP", "SAO PAULO", null)    → "Gasolina · São Paulo/SP"
 *      ("DIESEL S10", "BA", "SALVADOR", "SHELL") → "Diesel S10 · Salvador/BA (Shell)"
 */

/** Title Case simples que preserva siglas curtas (S10, S500, GNV, GLP). */
export function titleCase(text: string): string {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      if (/^s\d+$/.test(w)) return w.toUpperCase();
      if (/^(gnv|glp)$/.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

export function buildSeriesLabel(
  product: string,
  state: string,
  municipality: string,
  brand?: string | null
): string {
  const prod = titleCase(product);
  const city = titleCase(municipality);
  const uf = state.toUpperCase();
  const base = `${prod} · ${city}/${uf}`;
  return brand ? `${base} (${titleCase(brand)})` : base;
}
