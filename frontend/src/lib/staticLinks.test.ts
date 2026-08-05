import { describe, it, expect } from "vitest";

/**
 * Guarda contra uma classe de bug que escapou **três vezes** em 05/ago/2026.
 *
 * ## O bug
 *
 * As páginas fora do React vivem em `frontend/public/` e são servidas pelo nome
 * do arquivo: `/premium.html`, `/checkout.html`. O `vercel.json` cria apelidos
 * bonitos (`/premium`, `/premium/checkout`) por **rewrite** — e rewrite é coisa
 * da Vercel. No `vite dev` esses caminhos não existem: caem no fallback do SPA,
 * que devolve o `index.html`. Efeito prático: a pessoa clica em "Assinar" e é
 * jogada de volta no dashboard, como se o botão estivesse quebrado.
 *
 * Pior que simplesmente quebrar: **funciona em produção e falha em
 * desenvolvimento**. Quem testa local acha que estragou alguma coisa; quem
 * confere em produção não vê problema nenhum.
 *
 * ## A regra
 *
 * Link interno aponta para **arquivo que existe**. `/` é a raiz do app React e
 * vale sempre. Qualquer outro caminho tem de resolver para um arquivo real em
 * `public/`. A URL bonita continua funcionando para quem digita na barra de
 * endereço; ela só não é o que escrevemos no código.
 *
 * ## Por que `import.meta.glob` e não `node:fs`
 *
 * O `tsconfig` do frontend é deliberadamente só de navegador (`lib: DOM`), sem
 * `@types/node`. Puxar tipos de Node para um teste seria alargar a fronteira do
 * pacote por conveniência. O glob do Vite lê os arquivos sem sair do mundo do
 * bundler.
 */

// `eager` + `?raw`: o conteúdo dos arquivos entra como string na hora do teste.
const paginas = import.meta.glob("../../public/*.html", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Nomes de arquivo existentes em `public/`, para saber o que resolve. */
const arquivosPublicos = new Set(
  Object.keys(paginas).map((caminho) => caminho.split("/").pop() as string)
);

/**
 * Extrai os caminhos internos de uma página.
 *
 * Pega tanto os `href="/..."` do HTML quanto os montados em JavaScript
 * (`ctaHero.href = '/checkout.html?plan=' + key`) — o bug de 05/ago estava nos
 * dois lugares, e olhar só o HTML teria deixado metade passar.
 */
function linksInternos(html: string): string[] {
  const noHtml = [...html.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]);
  const noJs = [...html.matchAll(/\.href\s*=\s*['"](\/[^'"]*)['"]/g)].map((m) => m[1]);
  return [...new Set([...noHtml, ...noJs])];
}

/** O caminho resolve para algo servível? */
function resolve(link: string): boolean {
  const semQuery = link.split("?")[0].split("#")[0];
  if (semQuery === "/" || semQuery === "") return true; // app React

  const nome = semQuery.replace(/^\//, "");
  // Subpasta em public/ nunca existiu aqui; se um dia existir, este teste avisa.
  if (nome.includes("/")) return false;
  // `.css`, `.svg` e afins moram em public/ mas não entram no glob de HTML.
  if (!nome.endsWith(".html")) return true;

  return arquivosPublicos.has(nome);
}

describe("links internos das páginas estáticas", () => {
  it("achou páginas para conferir — teste que passa vazio não guarda nada", () => {
    expect(Object.keys(paginas).length).toBeGreaterThan(0);
  });

  it.each(Object.keys(paginas))("%s aponta só para caminhos que existem", (caminho: string) => {
    const quebrados = linksInternos(paginas[caminho]).filter((l) => !resolve(l));

    expect(
      quebrados,
      `Em ${caminho} há link(s) que só funcionam na Vercel: ${quebrados.join(", ")}. ` +
        `Use o arquivo real (ex.: /premium.html) — funciona no vite dev e em produção.`
    ).toEqual([]);
  });
});
