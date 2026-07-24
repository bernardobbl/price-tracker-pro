import type { SeriesView } from "../types";
import { titleCase } from "./seriesLabel";

/** Formata um preço em R$ com casas decimais (combustível usa 3). */
export function fmt(n: number, decimals = 3): string {
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
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
