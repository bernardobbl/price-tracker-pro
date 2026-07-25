/**
 * Descoberta dos arquivos mensais da ANP pela LISTAGEM da pasta do ano.
 *
 * Por que descobrir em vez de montar a URL por padrão: em 2026 a ANP **mudou o
 * naming** dos arquivos — e de forma inconsistente. Exemplos reais da pasta
 * `.../shpc/dsan/2026/` (jul/2026):
 *   - `01-dados-abertos-precos-gasolina-etanol.csv`         (mês virou prefixo)
 *   - `02-cados-abertos-preco-gasolina-etanol.csv`          (typo do próprio portal!)
 *   - `04-dados-abertos-precos-gasolina-etanol`             (sem extensão .csv)
 *   - `06-dados-abertos-precos-2026-06-gasolina-etanol.csv` (outro formato)
 * Enquanto 2025 usava `precos-gasolina-etanol-12.csv`. Nenhum padrão fixo
 * sobrevive a isso — a única fonte confiável é o **href real** publicado na
 * página da pasta. Estas funções são puras (recebem o HTML como string) e
 * testadas com fixture da listagem real.
 */

export type AnpGroup = "gasolina-etanol" | "diesel-gnv";

export interface AnpFileLink {
  /** Mês com 2 dígitos ("01".."12"). */
  month: string;
  group: AnpGroup;
  /** URL absoluta e direta do arquivo (sem o sufixo `/view` do Plone). */
  url: string;
}

/**
 * Classifica o arquivo pelo nome, tolerante aos typos do portal ("preco"/"precos",
 * "cados"/"dados"): basta conter o combustível. GLP existe na pasta, mas está fora
 * do escopo automotivo → retorna null (assim como qualquer link não-arquivo).
 */
export function classifyAnpGroup(fileName: string): AnpGroup | null {
  const n = fileName.toLowerCase();
  if (n.includes("glp")) return null;
  if (n.includes("gasolina") || n.includes("etanol")) return "gasolina-etanol";
  if (n.includes("diesel") || n.includes("gnv")) return "diesel-gnv";
  return null;
}

/**
 * Extrai o mês do nome do arquivo. Suporta os dois estilos observados:
 *   - 2026: prefixo `MM-...` (ex.: `05-dados-abertos-precos-gasolina-etanol.csv`)
 *   - 2025: sufixo `...-MM.csv` (ex.: `precos-gasolina-etanol-12.csv`)
 */
export function extractMonthFromName(fileName: string): string | null {
  const prefix = fileName.match(/^(\d{2})[-_]/);
  if (prefix && Number(prefix[1]) >= 1 && Number(prefix[1]) <= 12) return prefix[1];
  const suffix = fileName.match(/-(\d{2})\.csv$/i);
  if (suffix && Number(suffix[1]) >= 1 && Number(suffix[1]) <= 12) return suffix[1];
  return null;
}

/**
 * Extrai da listagem HTML da pasta do ano os links de arquivo de preço.
 * - considera só hrefs dentro de `.../dsan/<ano>/`;
 * - remove o sufixo `/view` (página de visualização do Plone; a URL direta baixa o CSV);
 * - absolutiza hrefs relativos;
 * - deduplica por (mês, grupo), mantendo a primeira ocorrência.
 */
export function extractAnpFileLinks(html: string, year: string): AnpFileLink[] {
  const links: AnpFileLink[] = [];
  const seen = new Set<string>();
  const hrefRe = /href="([^"]*\/dsan\/(\d{4})\/[^"]+?)"/g;

  for (const match of html.matchAll(hrefRe)) {
    if (match[2] !== year) continue;

    let url = match[1].replace(/\/view\/?$/, "");
    if (!/^https?:\/\//i.test(url)) {
      url = `https://www.gov.br${url.startsWith("/") ? "" : "/"}${url}`;
    }

    const fileName = url.split("/").pop() ?? "";
    const group = classifyAnpGroup(fileName);
    const month = extractMonthFromName(fileName);
    if (!group || !month) continue; // pasta, GLP, breadcrumb, etc.

    const key = `${month}|${group}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ month, group, url });
  }

  return links;
}
