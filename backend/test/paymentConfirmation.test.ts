/**
 * Comprovante de pagamento.
 *
 * Este e-mail é o **único registro que o cliente tem** da compra fora do nosso
 * banco. Se ele limpar o navegador, esquecer a senha ou só quiser conferir até
 * quando pagou, é para cá que ele volta. Valor, data ou código errados aqui não
 * são "erro de texto" — são o comprovante de uma transação de dinheiro.
 *
 * Por isso os testes cobram conteúdo, e não formatação bonita: cada `expect`
 * abaixo é um dado que alguém vai procurar depois.
 */

import { describe, it, expect } from "vitest";
import { montarConteudoConfirmacao } from "../src/lib/paymentConfirmation";

const base = {
  plan: "anual" as const,
  amountCents: 5990,
  paidAt: new Date("2026-08-06T14:30:00Z"),
  expiresAt: new Date("2027-08-06T14:30:00Z"),
  chargeId: "c0ffee00-1111-2222-3333-444444444444",
  appUrl: "https://precos-combustivel-br.vercel.app",
};

describe("montarConteudoConfirmacao", () => {
  it("põe plano e data de validade no assunto — é o que se lê na caixa de entrada", () => {
    const { subject } = montarConteudoConfirmacao(base);

    expect(subject).toContain("Premium anual");
    expect(subject).toContain("06/08/2027");
  });

  it("traz os quatro dados da compra: plano, valor, pagamento e validade", () => {
    const { text } = montarConteudoConfirmacao(base);

    expect(text).toContain("Premium anual");
    expect(text).toContain("R$ 59,90");
    expect(text).toContain("06/08/2026"); // pago em
    expect(text).toContain("06/08/2027"); // vale até
  });

  // Depois de uma exclusão de conta (LGPD), `user_id` vira nulo e nenhuma busca
  // por pessoa alcança a cobrança. Este código é a única alça que sobra.
  it("carrega o código da cobrança, e diz para guardar", () => {
    const { text } = montarConteudoConfirmacao(base);

    expect(text).toContain(base.chargeId);
    expect(text).toMatch(/guarde o código/i);
  });

  // Informar o prazo faz parte de respeitá-lo. O consumidor não deveria ter que
  // ir ler a política por conta própria para descobrir que tem 7 dias.
  it("informa o prazo do art. 49 do CDC com a data-limite calculada", () => {
    const { text } = montarConteudoConfirmacao(base);

    expect(text).toContain("13/08/2026"); // 06/08 + 7 dias
    expect(text).toMatch(/art\. 49/i);
    expect(text).toMatch(/integral/i);
  });

  // A dúvida nº 1 de quem acabou de pagar por Pix, e a única linha do produto
  // que não pode divergir: em nenhum lugar existe cobrança recorrente.
  it("afirma que não há cobrança automática", () => {
    const { text } = montarConteudoConfirmacao(base);
    expect(text).toMatch(/não existe cobrança automática/i);
  });

  it("adapta plano e cobertura no mensal", () => {
    const { subject, text } = montarConteudoConfirmacao({
      ...base,
      plan: "mensal",
      amountCents: 1690,
      expiresAt: new Date("2026-09-06T14:30:00Z"),
    });

    expect(subject).toContain("Premium mensal");
    expect(text).toContain("1 mês de acesso");
    expect(text).toContain("R$ 16,90");
  });

  it("usa fuso de São Paulo, não UTC — data de compra errada por um dia é reclamação", () => {
    // 23:30 UTC de 06/08 é 20:30 de 06/08 em São Paulo. Já 02:00 UTC de 07/08
    // ainda é dia 06 aqui — é este caso que denuncia um `toLocaleDateString`
    // sem `timeZone`.
    const { text } = montarConteudoConfirmacao({
      ...base,
      paidAt: new Date("2026-08-07T02:00:00Z"),
    });

    expect(text).toContain("06/08/2026");
  });

  it("sem appUrl não quebra — só sai sem links", () => {
    const { text } = montarConteudoConfirmacao({ ...base, appUrl: null });

    expect(text).toContain("R$ 59,90");
    expect(text).not.toContain("http");
  });

  it("com appUrl, aponta para o app e para a política de reembolso", () => {
    const { text } = montarConteudoConfirmacao(base);

    expect(text).toContain("https://precos-combustivel-br.vercel.app/");
    expect(text).toContain("/reembolso.html");
  });
});
