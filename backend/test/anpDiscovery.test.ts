import { describe, it, expect } from "vitest";
import {
  classifyAnpGroup,
  extractAnpFileLinks,
  extractMonthFromName,
} from "../src/ingest/anpDiscovery";

const BASE = "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/shpc/dsan";

/**
 * Fixture fiel à listagem REAL de `.../dsan/2026/` (jul/2026), incluindo as
 * inconsistências do portal que motivaram a descoberta por listagem:
 * typo em fevereiro ("cados"/"preco"), abril sem extensão, junho com formato
 * diferente, GLP presente (fora do escopo) e links de navegação/pasta.
 */
const FIXTURE_2026 = `
<html><body>
  <a href="${BASE}/2026/">Pasta</a>
  <a href="${BASE}/2026/01-dados-abertos-precos-glp.csv/view">precos-glp.csv</a>
  <a href="${BASE}/2026/01-dados-abertos-precos-gasolina-etanol.csv/view">precos-gasolina-etanol.csv</a>
  <a href="${BASE}/2026/01-dados-abertos-precos-diesel-gnv.csv/view">precos-diesel-gnv.csv</a>
  <a href="${BASE}/2026/02-cados-abertos-preco-gasolina-etanol.csv/view">fevereiro (typo do portal)</a>
  <a href="${BASE}/2026/02-dados-abertos-precos-diesel-gnv.csv/view">precos-diesel-gnv.csv</a>
  <a href="${BASE}/2026/04-dados-abertos-precos-gasolina-etanol/view">abril sem extensão</a>
  <a href="${BASE}/2026/05-dados-abertos-precos-gasolina-etanol.csv/view">maio</a>
  <a href="${BASE}/2026/05-dados-abertos-precos-diesel-gnv.csv/view">maio diesel</a>
  <a href="${BASE}/2026/06-dados-abertos-precos-2026-06-gasolina-etanol.csv/view">junho (outro formato)</a>
  <a href="${BASE}/2025/precos-gasolina-etanol-12.csv">ano errado, ignora</a>
  <a href="https://www.gov.br/anp/pt-br/centrais-de-conteudo">navegação</a>
</body></html>`;

describe("classifyAnpGroup", () => {
  it("classifica pelos combustíveis, tolerante a typos do portal", () => {
    expect(classifyAnpGroup("02-cados-abertos-preco-gasolina-etanol.csv")).toBe("gasolina-etanol");
    expect(classifyAnpGroup("precos-diesel-gnv-12.csv")).toBe("diesel-gnv");
  });

  it("ignora GLP (fora do escopo automotivo) e nomes sem combustível", () => {
    expect(classifyAnpGroup("01-dados-abertos-precos-glp.csv")).toBeNull();
    expect(classifyAnpGroup("relatorio-anual.pdf")).toBeNull();
  });
});

describe("extractMonthFromName", () => {
  it("lê o prefixo MM- do estilo 2026 (mesmo sem extensão)", () => {
    expect(extractMonthFromName("05-dados-abertos-precos-gasolina-etanol.csv")).toBe("05");
    expect(extractMonthFromName("04-dados-abertos-precos-gasolina-etanol")).toBe("04");
    expect(extractMonthFromName("06-dados-abertos-precos-2026-06-gasolina-etanol.csv")).toBe("06");
  });

  it("lê o sufixo -MM.csv do estilo 2025", () => {
    expect(extractMonthFromName("precos-gasolina-etanol-12.csv")).toBe("12");
  });

  it("rejeita valores fora de 01..12 e nomes sem mês", () => {
    expect(extractMonthFromName("13-dados-abertos-precos-gasolina-etanol.csv")).toBeNull();
    expect(extractMonthFromName("precos-gasolina-etanol.csv")).toBeNull();
  });
});

describe("extractAnpFileLinks", () => {
  const links = extractAnpFileLinks(FIXTURE_2026, "2026");

  it("extrai só arquivos de preço do ano pedido (sem GLP, pasta ou navegação)", () => {
    const keys = links.map((l) => `${l.month}|${l.group}`).sort();
    expect(keys).toEqual([
      "01|diesel-gnv",
      "01|gasolina-etanol",
      "02|diesel-gnv",
      "02|gasolina-etanol",
      "04|gasolina-etanol",
      "05|diesel-gnv",
      "05|gasolina-etanol",
      "06|gasolina-etanol",
    ]);
  });

  it("remove o sufixo /view (URL direta baixa o CSV)", () => {
    expect(links.every((l) => !l.url.endsWith("/view"))).toBe(true);
  });

  it("sobrevive ao typo de fevereiro e ao abril sem extensão", () => {
    const feb = links.find((l) => l.month === "02" && l.group === "gasolina-etanol");
    expect(feb?.url).toContain("02-cados-abertos-preco-gasolina-etanol.csv");
    const apr = links.find((l) => l.month === "04");
    expect(apr?.url.endsWith("04-dados-abertos-precos-gasolina-etanol")).toBe(true);
  });

  it("absolutiza hrefs relativos", () => {
    const html = `<a href="/anp/pt-br/x/dsan/2026/05-dados-abertos-precos-gasolina-etanol.csv/view">a</a>`;
    const [link] = extractAnpFileLinks(html, "2026");
    expect(link.url).toBe(
      "https://www.gov.br/anp/pt-br/x/dsan/2026/05-dados-abertos-precos-gasolina-etanol.csv"
    );
  });

  it("deduplica por (mês, grupo) mantendo a primeira ocorrência", () => {
    const html = `
      <a href="${BASE}/2026/05-dados-abertos-precos-gasolina-etanol.csv/view">a</a>
      <a href="${BASE}/2026/05-dados-abertos-precos-gasolina-etanol.csv/view">b</a>`;
    expect(extractAnpFileLinks(html, "2026")).toHaveLength(1);
  });
});
