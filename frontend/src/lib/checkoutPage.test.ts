import { describe, it, expect } from "vitest";

/**
 * Guardas do `public/checkout.html` — a única página que move dinheiro e a
 * única sem compilador olhando por cima do ombro.
 *
 * ## Por que testar um arquivo estático
 *
 * O checkout é HTML puro com `<script>` inline: não passa pelo TypeScript, não
 * passa pelo bundler, e um `$('qrPh')` escrito errado só aparece como um botão
 * que não faz nada — na tela de pagamento, diante de quem já decidiu pagar.
 * O React tem `tsc`; esta página tem estes testes.
 *
 * Cada bloco abaixo é a cicatriz de um defeito real, não uma hipótese.
 */

const paginas = import.meta.glob("../../public/*.html", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const checkout = Object.entries(paginas).find(([caminho]) =>
  caminho.endsWith("checkout.html")
)?.[1];

describe("checkout.html", () => {
  it("foi encontrado — teste que passa sem arquivo não guarda nada", () => {
    expect(checkout, "public/checkout.html sumiu ou mudou de nome").toBeTruthy();
  });

  // ── 1. Todo `$('id')` do script existe no HTML ──────────────────────────
  //
  // `$` é `document.getElementById`. Um id errado devolve `null`, e a linha
  // seguinte (`.style`, `.textContent`, `.addEventListener`) estoura em tempo
  // de execução — derrubando o resto do script inteiro, inclusive o polling
  // que confirma o pagamento. Sem este teste, nada avisa antes do usuário.
  it("não referencia nenhum id que não existe no HTML", () => {
    const html = checkout as string;

    const idsUsados = [...html.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
    const idsExistentes = new Set(
      [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])
    );

    expect(idsUsados.length, "o script deixou de usar $() — reescreva este teste").toBeGreaterThan(
      10
    );

    const orfaos = [...new Set(idsUsados)].filter((id) => !idsExistentes.has(id));
    expect(
      orfaos,
      `$('id') sem elemento correspondente: ${orfaos.join(", ")}. ` +
        `getElementById devolve null e a próxima linha derruba o script todo.`
    ).toEqual([]);
  });

  // ── 2. O contador de partida bate com a validade real do QR ─────────────
  //
  // O HTML traz um valor fixo que aparece antes de o JavaScript rodar. Ele
  // ficou em "15:00" enquanto `EXPIRES_SECONDS` já era 30 min — um contador
  // menor que o código faz a tela dizer "expirou" com o Pix ainda válido, e a
  // pessoa desiste de um pagamento que teria funcionado. A armadilha nº 7 de
  // `docs/proximos-passos.md` avisa sobre exatamente essa dessincronia.
  it("mostra, no HTML, o mesmo tempo de validade que o script usa", () => {
    const html = checkout as string;

    const segundos = html.match(/var EXPIRES_SECONDS\s*=\s*(\d+)\s*\*\s*60/);
    expect(segundos, "EXPIRES_SECONDS mudou de forma — confira o casamento à mão").toBeTruthy();

    const minutos = Number(segundos![1]);
    const noHtml = html.match(/id="timer">(\d+):(\d+)</);
    expect(noHtml, 'o #timer perdeu o valor inicial ("MM:SS")').toBeTruthy();

    expect(
      Number(noHtml![1]),
      `#timer começa em ${noHtml![1]} min mas o QR vale ${minutos} min. ` +
        `Contador menor que o código = "expirou" mentiroso na tela.`
    ).toBe(minutos);
  });

  // ── 3. O aviso de sandbox existe e é ligado pelo BACKEND ────────────────
  //
  // Um brCode de teste é indistinguível de um real na tela, e nenhum banco o
  // aceita. Sem aviso, o sintoma vira "o QR não funciona" — foi assim que
  // chegou em 05/ago/2026. O gatilho tem de ser o campo `environment` da
  // resposta: deduzir pelo hostname já falhou (frontend publicado + backend em
  // modo teste não acusava nada).
  it("avisa quando o código é de sandbox, e decide isso pela resposta do backend", () => {
    const html = checkout as string;

    expect(html, "sumiu o elemento do aviso de sandbox").toContain('id="sandboxNote"');
    expect(
      html,
      "o aviso precisa depender de `environment` vindo do backend, não do hostname"
    ).toMatch(/c\.environment\s*!==\s*'production'/);
    expect(html, "o campo `environment` deixou de ser lido da resposta").toContain(
      "environment: d.environment"
    );
  });

  // ── 4. Nada que o backend devolve pode ser descartado em silêncio ───────
  //
  // `ticketUrl` era devolvido pela API e simplesmente jogado fora: a página
  // hospedada do Mercado Pago — a saída de quem não consegue ler o QR desta
  // tela — existia e ninguém via.
  it("usa o ticketUrl que o backend devolve", () => {
    const html = checkout as string;

    expect(html).toContain("ticketUrl: d.ticketUrl");
    expect(html, "o link do Mercado Pago não é exibido em lugar nenhum").toContain(
      "ticketLink"
    );
  });

  // ── 5. Cold start: silêncio de 50s numa tela de pagamento ───────────────
  //
  // O backend hiberna no free tier do Render e a primeira requisição leva até
  // um minuto. Sem timeout nem aviso, o botão ficava "Gerando…" em silêncio e a
  // leitura natural é "quebrou" — a pessoa fecha a aba no meio da compra.
  it("avisa e desiste em vez de esperar calada pelo servidor acordar", () => {
    const html = checkout as string;

    expect(html, "o fetch do checkout voltou a não ter timeout").toContain("AbortController");
    expect(html, "sumiu o aviso de que o servidor está acordando").toMatch(/Acordando o servidor/);
    // Sem este caso, o abort cai na mensagem genérica de "tente de novo em
    // instantes" — que, depois de um minuto esperando, soa como deboche.
    expect(html, "o estouro de tempo não tem mensagem própria").toMatch(
      /demorou demais para responder/
    );
    // Importa dizer que nada foi cobrado: a dúvida de quem desiste no meio de
    // um pagamento é sempre "será que passou?".
    //
    // A frase está quebrada em duas linhas com concatenação (`'…' + '…'`), então
    // procuramos só o pedaço que sobrevive à quebra — casar a frase inteira
    // deixaria o teste refém da largura da linha.
    expect(html).toContain("cobrança foi criada");
  });

  // ── 6. 503 não pode virar "tente de novo" ───────────────────────────────
  //
  // `BILLING_DISABLED` significa que as credenciais não estão no servidor:
  // insistir não muda nada. Mandar a pessoa tentar de novo é pedir para ela
  // repetir um caminho que nunca vai dar certo.
  it("trata 503 (cobrança desligada) sem mandar tentar de novo", () => {
    const html = checkout as string;

    expect(html, "o código 503 não é distinguido dos demais erros").toMatch(
      /r\.status === 503|code === 503/
    );
    expect(html).toContain("tentar de novo não vai adiantar");
  });
});
