/**
 * Comprovante de pagamento — conteúdo puro, sem I/O.
 *
 * ## Por que este arquivo existe
 *
 * Os Termos de Uso prometem, por escrito, no item "Sua conta":
 *
 *   *"Informe um e-mail válido e que você controle — é por ele que os alertas
 *   **e a confirmação de pagamento** chegam."*
 *
 * Durante toda a construção do checkout, **nenhum e-mail de confirmação foi
 * enviado**: o `emailService` só sabia mandar alerta de preço e aviso de
 * vencimento. Quem pagasse R$ 59,90 não receberia nada nosso, e o único
 * registro da compra seria um selo no header do app — que some ao limpar o
 * navegador ou ao esquecer a senha.
 *
 * ## O que este e-mail precisa carregar, e por quê
 *
 * Não é uma mensagem de cortesia; é o comprovante do cliente. Cada bloco
 * responde a uma pergunta que aparece depois, quando ninguém está por perto:
 *
 *  - **o que foi comprado e por quanto** — "eu paguei quanto mesmo?";
 *  - **até quando vale** — a data exata, porque não há renovação automática e
 *    o acesso simplesmente termina;
 *  - **o código da cobrança** — é o que identifica o pagamento num pedido de
 *    reembolso. Depois de uma exclusão de conta (LGPD), é a *única* alça que
 *    resta: `user_id` vira nulo e nenhuma busca por pessoa alcança a linha;
 *  - **o direito de arrependimento de 7 dias** — art. 49 do CDC. Informar o
 *    prazo faz parte de respeitá-lo; o consumidor não pode depender de ler a
 *    política por conta própria para descobrir que ele existe;
 *  - **a ausência de cobrança automática** — dita de novo, porque é a dúvida
 *    número um de quem acabou de pagar por Pix.
 *
 * Puro e exportado para ter teste próprio: e-mail de dinheiro com data ou valor
 * errado é pior que e-mail nenhum.
 */

import type { PlanKey } from "./subscriptionPeriod";

export interface PaymentConfirmationContent {
  subject: string;
  text: string;
}

function dataBR(d: Date): string {
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
}

function brl(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

/** Último dia do prazo do art. 49 do CDC, a partir do pagamento. */
const CDC_DAYS = 7;

export function montarConteudoConfirmacao(params: {
  plan: PlanKey;
  amountCents: number;
  paidAt: Date;
  expiresAt: Date;
  /** Id da cobrança — o número que o suporte pede num pedido de reembolso. */
  chargeId: string;
  /** URL do app, para os links. Sem ela o e-mail sai sem link, e não quebra. */
  appUrl?: string | null;
}): PaymentConfirmationContent {
  const { plan, amountCents, paidAt, expiresAt, chargeId, appUrl } = params;

  const nomePlano = plan === "anual" ? "Premium anual" : "Premium mensal";
  const cobertura = plan === "anual" ? "12 meses" : "1 mês";

  const limiteArrependimento = new Date(paidAt.getTime() + CDC_DAYS * 86_400_000);
  const base = appUrl ? appUrl.replace(/\/$/, "") : null;

  const subject = `Pagamento confirmado — ${nomePlano} até ${dataBR(expiresAt)}`;

  const linhas = [
    `Oi!`,
    ``,
    `Seu pagamento foi confirmado e o acesso já está liberado.`,
    ``,
    `─────────────────────────────────────────`,
    `Plano:      ${nomePlano} (${cobertura} de acesso)`,
    `Valor:      ${brl(amountCents)}`,
    `Pago em:    ${dataBR(paidAt)}`,
    `Vale até:   ${dataBR(expiresAt)}`,
    `Cobrança:   ${chargeId}`,
    `─────────────────────────────────────────`,
    ``,
    // Guardar o código não é burocracia nossa: é o que torna possível pedir
    // reembolso depois, inclusive se a conta for excluída no meio do caminho.
    `Guarde o código da cobrança. É por ele que identificamos o seu pagamento`,
    `se você precisar falar com a gente.`,
    ``,
    `NÃO existe cobrança automática. Nada será debitado de você quando o acesso`,
    `vencer — avisamos por e-mail antes, e você decide se quer renovar.`,
    ``,
    `Mudou de ideia? Você tem até ${dataBR(limiteArrependimento)} para desistir e`,
    `receber o valor integral de volta (art. 49 do Código de Defesa do`,
    `Consumidor), mesmo que já tenha usado.`,
    ``,
  ];

  if (base) {
    linhas.push(`Acessar o app:  ${base}/`, `Reembolso:      ${base}/reembolso.html`, ``);
  }

  linhas.push(`— Price Tracker Pro`);

  return { subject, text: linhas.join("\n") };
}
