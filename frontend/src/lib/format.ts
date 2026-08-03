import type { SeriesView } from "../types";
import { titleCase } from "./seriesLabel";

/** Formata um preço em R$ com casas decimais (combustível usa 3). */
export function fmt(n: number, decimals = 3): string {
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Rótulo de um "tick" do eixo Y do gráfico.
 *
 * O Chart.js calcula os ticks por soma sucessiva (6,6 → +0,2 → +0,2 …), e essa
 * acumulação carrega o erro clássico de ponto flutuante: 7.6 vira
 * 7.600000000000001. Interpolar o valor cru no rótulo expunha esse ruído na
 * tela — só em algumas faixas de preço, porque depende do passo escolhido.
 * Passar sempre pelo `fmt` corta o ruído e ainda alinha o eixo ao padrão pt-BR
 * (vírgula decimal) usado no resto do app.
 */
export function formatAxisPrice(
  value: string | number,
  currency: string,
  decimals = 3
): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return `${currency} ${value}`;
  return `${currency} ${fmt(n, decimals)}`;
}

/** "AV BRASIL, 1234 · PINHEIROS" a partir dos campos de endereço (o que existir). */
export function formatLocation(q: {
  street?: string | null;
  streetNumber?: string | null;
  neighborhood?: string | null;
}): string {
  const streetPart = [q.street ? titleCase(q.street) : "", q.streetNumber ?? ""]
    .filter(Boolean)
    .join(", ");
  const bairro = q.neighborhood ? titleCase(q.neighborhood) : "";
  return [streetPart, bairro].filter(Boolean).join(" · ");
}

/**
 * Link de busca no Google Maps a partir do que sabemos do posto: nome + endereço
 * + município/UF. Com os dados reais da ANP (endereço exato), o Maps localiza o
 * posto; na amostra de demo os postos são fictícios (ver `DEMO_MODE`).
 */
export function mapsUrl(
  q: { reseller: string; street?: string | null; streetNumber?: string | null; neighborhood?: string | null },
  loc: { municipality: string; state: string }
): string {
  const query = [
    q.reseller,
    q.street ? titleCase(q.street) : "",
    q.streetNumber ?? "",
    q.neighborhood ? titleCase(q.neighborhood) : "",
    titleCase(loc.municipality),
    loc.state,
    "Brasil",
  ]
    .filter(Boolean)
    .join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Verdadeiro se dois recortes de série apontam para a mesma combinação. */
export function sameSeries(
  a: SeriesView,
  b: { product: string; state: string; municipality: string; brand: string | null }
): boolean {
  return (
    a.product === b.product &&
    a.state === b.state &&
    a.municipality === b.municipality &&
    (a.brand ?? null) === (b.brand ?? null)
  );
}
