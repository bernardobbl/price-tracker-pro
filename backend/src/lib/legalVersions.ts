/**
 * Versões conhecidas dos documentos legais.
 *
 * A dupla **versão + horário do aceite** é a única prova de que a pessoa
 * concordou com os Termos, a Privacidade e o Reembolso vigentes na hora da
 * compra. O horário já vem do relógio do servidor — não do cliente — porque
 * data enviada pelo navegador não prova nada.
 *
 * A versão precisava do mesmo tratamento. Antes ela era `z.string().min(1)`:
 * um cliente forjado gravaria `"999.0"` ou `"nenhuma"` e o registro viraria
 * ficção. Como o front é quem sabe qual versão ele exibiu, a única saída é o
 * backend recusar o que não conhece.
 *
 * ## Ao editar termos.html, privacidade.html ou reembolso.html
 *
 * 1. adicione a nova versão em `LEGAL_VERSIONS` **sem remover as antigas** —
 *    cobranças passadas apontam para elas e o histórico tem de continuar
 *    legível;
 * 2. atualize `LEGAL_VERSION` no `frontend/public/checkout.html` para a nova.
 *
 * A ordem importa: se o front subir antes do backend, o checkout começa a
 * responder 400 para todo mundo.
 */

/**
 * Versões aceitas no checkout. A primeira posição é a corrente por convenção,
 * mas o backend aceita qualquer uma da lista — um cliente com a página em
 * cache não pode ser bloqueado no meio de uma compra.
 */
export const LEGAL_VERSIONS = ["1.0"] as const;

export type LegalVersion = (typeof LEGAL_VERSIONS)[number];

/** Versão vigente — a que o checkout deveria estar enviando hoje. */
export const CURRENT_LEGAL_VERSION: LegalVersion = LEGAL_VERSIONS[0];

export function isKnownLegalVersion(value: string): value is LegalVersion {
  return (LEGAL_VERSIONS as readonly string[]).includes(value);
}
