import { describe, it, expect } from "vitest";

/**
 * Guarda contra a classe de bug mais cara deste projeto: **a página afirmando
 * uma coisa e o código fazendo outra.**
 *
 * O `staticLinks.test.ts` ao lado tranca os *links* das páginas estáticas. Este
 * tranca o *texto* — porque o padrão já se repetiu quatro vezes, sempre igual:
 *
 *  • 06/ago — `premium.html` coletava e-mail com a legenda "Te aviso quando o
 *    Premium abrir", e o handler chamava `form.reset()` sem enviar nada;
 *  • 06/ago — o mesmo arquivo dizia "Estamos medindo o interesse antes de
 *    lançar" no rodapé, a um clique de um débito de R$ 59,90;
 *  • 06/ago — "Posso cancelar? Sim, a qualquer momento, **em um clique**", sem
 *    que existisse clique nenhum em lugar nenhum do produto;
 *  • 06/ago — "12 meses de histórico" vendido como benefício do Premium, três
 *    parágrafos acima do FAQ que promete o mesmo de graça "para sempre".
 *
 * Nenhum deles quebrava nada. Nenhum teste falhava, nenhum log reclamava. Todos
 * foram achados lendo a tela ao lado do código — trabalho manual que não escala
 * e que ninguém repete a cada commit.
 *
 * ## O que este arquivo faz, e o que ele não consegue fazer
 *
 * Ele **não** verifica se uma promessa é cumprida: isso exige julgamento. Ele
 * verifica que **promessas específicas, já derrubadas por conferência manual,
 * não voltem** — porque o jeito mais provável de elas voltarem é alguém
 * "restaurando a funcionalidade" sem ler o histórico.
 *
 * Ao remover uma promessa daqui, o critério é um só: existe hoje, no código, a
 * coisa que a frase afirma? Se não existir, ela fica proibida.
 */

const paginas = import.meta.glob("../../public/*.html", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * Texto visível da página: fora comentários HTML, `<style>` e `<script>`.
 *
 * A distinção é essencial. Os comentários deste repositório **explicam** as
 * frases removidas, e precisam citá-las para que ninguém as recoloque por
 * ignorância. Um teste que olhasse o arquivo cru falharia justamente por causa
 * da documentação que o torna desnecessário.
 */
function textoVisivel(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

const visivel = Object.fromEntries(
  Object.entries(paginas).map(([caminho, html]) => [caminho, textoVisivel(html)])
);

/** Só as páginas de venda: as legais têm vocabulário próprio e outro dono. */
const paginasDeVenda = Object.keys(visivel).filter((c) =>
  /(premium|checkout)\.html$/.test(c)
);

interface Proibida {
  /** Trecho que não pode aparecer no texto visível. */
  frase: RegExp;
  /** Por que ela é falsa — vira a mensagem do erro. */
  porque: string;
}

const PROIBIDAS: Proibida[] = [
  {
    frase: /medindo o interesse|antes de lançar|porta falsa/i,
    porque:
      "o produto está no ar e cobrando de verdade desde 06/ago/2026, 12:44. " +
      "Descrever-se como experimento pré-lançamento numa página que emite cobrança " +
      "é uma afirmação falsa feita por escrito a um consumidor.",
  },
  {
    frase: /experimento da Fase 10/i,
    porque:
      "'experimento' era verdade enquanto o checkout usava credenciais de sandbox. " +
      "Hoje o Pix gerado é pagável e o valor cai numa conta real.",
  },
  {
    frase: /em um clique|num clique/i,
    porque:
      "não existe cancelamento em um clique — nem precisa existir: a compra é " +
      "avulsa, sem cobrança recorrente (Pix Automático exige CNPJ, ver " +
      "docs/recebimento-sem-cnpj.md). A frase mandava a pessoa procurar um botão " +
      "que nunca foi construído.",
  },
  {
    frase: /seu celular avisa|notificação no celular|push/i,
    porque:
      "o único canal implementado é e-mail — `createFuelAlertSchema` aceita " +
      "`channel: z.literal('email')` e nada mais. Não há app nativo nem push.",
  },
  {
    frase: /Te aviso (quando|assim que)/i,
    porque:
      "é a legenda do formulário de captura de e-mail removido em 06/ago/2026. " +
      "Ele prometia contato e descartava o endereço num `form.reset()`. Se alguém " +
      "quiser reintroduzir a captura, o endereço precisa ser GRAVADO em algum " +
      "lugar antes de a promessa voltar à tela.",
  },
  {
    frase: /preço de fundador travado|preço travado|congelad[oa]/i,
    porque:
      "não há mecanismo de preço por pessoa: `PLAN_PRICE_CENTS` é uma constante " +
      "única e cada renovação é uma compra nova pelo preço vigente. Prometer " +
      "congelamento de preço num contrato de consumo, sem código que o cumpra, é a " +
      "promessa mais cara que estas páginas já fizeram.",
  },
];

describe("promessas das páginas de venda", () => {
  it("achou as páginas de venda — teste que passa vazio não guarda nada", () => {
    expect(paginasDeVenda.length).toBeGreaterThanOrEqual(2);
  });

  it.each(paginasDeVenda)("%s não promete o que o código não faz", (caminho: string) => {
    const encontradas = PROIBIDAS.filter((p) => p.frase.test(visivel[caminho])).map(
      (p) => `\n  • /${p.frase.source}/ — ${p.porque}`
    );

    expect(
      encontradas,
      `O texto visível de ${caminho} contém promessa(s) já derrubadas por ` +
        `conferência manual:${encontradas.join("")}\n\n` +
        `Se o código passou a cumprir alguma delas, remova a entrada de PROIBIDAS ` +
        `neste arquivo — e cite onde está a implementação.`
    ).toEqual([]);
  });
});

describe("o que as páginas de venda PRECISAM dizer", () => {
  // O espelho do bloco acima: promessa removida é metade do trabalho. A outra
  // metade é garantir que os fatos que protegem o cliente não sumam junto numa
  // faxina de copy.
  it("a landing diz que não há cobrança automática", () => {
    const landing = visivel[paginasDeVenda.find((c) => c.includes("premium.html")) as string];
    expect(landing).toMatch(/sem cobrança automática|não existe cobrança automática/i);
  });

  it("o checkout diz o prazo de arrependimento do CDC", () => {
    const checkout = visivel[paginasDeVenda.find((c) => c.includes("checkout.html")) as string];
    expect(checkout).toMatch(/7 dias/i);
  });

  it("o checkout diz quem processa o pagamento", () => {
    const checkout = visivel[paginasDeVenda.find((c) => c.includes("checkout.html")) as string];
    expect(checkout).toMatch(/Mercado Pago/i);
  });
});

describe("o botão de simular pagamento não existe em produção", () => {
  /**
   * O comentário antigo do `checkout.html` afirmava que este botão "em produção
   * não é renderizado". Era falso: ele vinha no HTML sempre, com o listener
   * ligado, escondido só por `style.display='none'` aplicado depois. Um
   * `simBtn.click()` no console pintava "Pagamento confirmado" numa página de
   * cobrança real — sem liberar acesso (o gate é o backend), mas produzindo uma
   * captura de tela de confirmação falsa.
   *
   * Agora o elemento é criado por JavaScript dentro de `if (DEMO)`.
   */
  const checkout = paginas[Object.keys(paginas).find((c) => c.includes("checkout.html")) as string];

  it("não está no HTML estático", () => {
    const semComentarios = checkout.replace(/<!--[\s\S]*?-->/g, " ");
    const html = semComentarios.replace(/<script[\s\S]*?<\/script>/gi, " ");
    expect(html).not.toMatch(/id=["']simBtn["']/);
  });

  it("só é criado sob a bandeira de DEMO", () => {
    // Se o `simBtn` aparecer no script, tem de estar depois de um `if (DEMO)`.
    const script = checkout.match(/<script[\s\S]*?<\/script>/gi)?.join("\n") ?? "";
    if (!script.includes("simBtn")) return;
    expect(script).toMatch(/if\s*\(\s*DEMO\s*\)[\s\S]{0,600}simBtn/);
  });

  it("a página segue em modo de produção (DEMO desligado)", () => {
    expect(checkout).toMatch(/var\s+DEMO\s*=\s*false/);
  });
});
