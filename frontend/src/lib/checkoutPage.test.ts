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
    // Comentários fora antes de varrer. Este repositório documenta os defeitos
    // corrigidos citando o código que os causava — um comentário que explica
    // "`$('simBtn')` devolvia null aqui" não é uma chamada, é a lição. Sem esta
    // linha, a documentação da correção reprova a própria correção. (Código
    // comentado também sai, e deve mesmo: código comentado não executa.)
    //
    // O `//` só é removido quando ABRE a linha. Um `/\/\/.*/` solto engoliria
    // metade de qualquer `https://...` e, com ela, qualquer `$('id')` escrito
    // depois na mesma linha — o teste ficaria mais frouxo sem ninguém notar,
    // que é o pior resultado possível para um teste-guarda.
    const html = (checkout as string)
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/^[ \t]*\/\/[^\n]*/gm, " ");

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

  // ── 7. A faixa do topo não pode afirmar que a cobrança não é real ───────
  //
  // O cabeçalho deste arquivo proíbe deduzir ambiente do hostname, em dois
  // lugares, e o `#sandboxNote` obedecia. A faixa do topo não: ela via
  // `localhost` e escrevia **"Nenhuma cobrança é real"**.
  //
  // Rodar local contra um backend com `MERCADOPAGO_ENV=production` é um caso
  // previsto — `config/mercadoPago.ts` permite de propósito e loga "AMBIENTE
  // LOCAL COM TOKEN DE PRODUÇÃO — cobranças criadas aqui são REAIS". Nesse
  // cenário a tela afirmava o contrário do log, e o Pix cobrava.
  //
  // Note a direção do erro, que é o que torna este pior que o do `sandboxNote`:
  // aquele erra para o lado de **avisar**, este errava para o lado de
  // **tranquilizar**. Numa tela de pagamento, conforto sem evidência é dano.
  it("não afirma, a partir do hostname, que nenhuma cobrança é real", () => {
    const html = (checkout as string)
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/^[ \t]*\/\/[^\n]*/gm, " ");

    // A frase só pode existir sob `DEMO`, que é a única situação em que a
    // página sabe, sozinha, que não há cobrança nenhuma.
    const trechoLocalhost = html.match(
      /API\.indexOf\('localhost'\)[\s\S]{0,600}?\)\(\);/
    );
    expect(trechoLocalhost, "o bloco `avisarModo` mudou de forma — revise à mão").toBeTruthy();

    expect(
      trechoLocalhost![0],
      "a faixa voltou a garantir, pelo hostname, que a cobrança não é real"
    ).not.toMatch(/Nenhuma cobrança é real|não cobra nada/i);
  });

  it("corrige a faixa quando o backend responde que está em produção", () => {
    const html = checkout as string;

    expect(html, "sumiu o ajuste da faixa pelo ambiente informado pelo backend").toContain(
      "ajustarFaixaAoAmbiente"
    );
    // O caso que motivou tudo: local + backend produtivo = dinheiro de verdade,
    // e a pessoa está mentalmente em "estou testando".
    expect(html, "o aviso de backend produtivo em ambiente local sumiu").toMatch(
      /modo PRODUÇÃO/
    );
  });

  // ── 8. Expiração vinda do provedor não pode ser silenciosa ──────────────
  //
  // `status: 'expired'` só chamava `stopPolling()`: sem mensagem, sem botão, e
  // com o cronômetro local continuando a correr. Quem manda na validade é o
  // Mercado Pago, não o nosso `setInterval` — e os dois divergem quando o
  // `expiresAt` não vem na resposta, quando o relógio do cliente está adiantado
  // ou quando a order é cancelada mais cedo. Nesses casos a pessoa ficava
  // olhando "Aguardando o pagamento…" com contador vivo e código morto, sem
  // nada capaz de tirá-la dali — o polling já tinha sido desligado.
  it("quando o provedor diz que expirou, para o relógio e oferece saída", () => {
    const html = (checkout as string).replace(/<!--[\s\S]*?-->/g, " ");

    const ramo = html.match(/d\.status === 'expired'\)\s*\{[\s\S]{0,700}?\n\s*\}/);
    expect(ramo, "o tratamento de `expired` sumiu ou virou uma linha só").toBeTruthy();

    const corpo = ramo![0];
    expect(corpo, "o cronômetro continua correndo depois de expirar").toContain(
      "clearInterval(state.tick)"
    );
    expect(corpo, "expirou sem dizer nada na tela").toContain("setStatus");
    expect(corpo, "expirou sem oferecer o caminho de gerar outro código").toContain("againBtn");
  });

  // ── 9. A confirmação diz o que o BACKEND registrou ──────────────────────
  //
  // `onPaid` montava a frase "Seu acesso <plano> foi liberado" a partir de
  // `state.plan` — variável do navegador. O seletor de plano continua clicável
  // com o QR na tela, então dá para pagar o mensal e ler "anual". Quem sabe o
  // que foi comprado é o registro da cobrança, e ele vem na resposta do polling.
  it("monta a confirmação com o plano que o backend devolveu", () => {
    const html = checkout as string;

    expect(html, "onPaid voltou a ser chamado sem a resposta do backend").toContain(
      "onPaid(d)"
    );
    expect(html, "a confirmação não usa mais o plano confirmado pelo servidor").toContain(
      "planoConfirmado"
    );
  });

  // ── 10. Contador: zero é resposta, não ausência de resposta ─────────────
  //
  // `state.left = c.expiresIn || EXPIRES_SECONDS` tratava **0** como "não
  // informado" e caía no padrão de 30 minutos. Uma cobrança que chega já
  // vencida (relógios fora de sincronia, resposta lenta) ganharia um contador
  // novo em folha para um código morto.
  it("não confunde validade zero com validade ausente", () => {
    const html = checkout as string;

    expect(
      html,
      "voltou o `||` no cálculo do contador — zero cairia no padrão de 30 min"
    ).not.toMatch(/state\.left\s*=\s*c\.expiresIn\s*\|\|/);
    expect(html).toMatch(/c\.expiresIn\s*!=\s*null/);
  });
});
