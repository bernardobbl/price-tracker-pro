import { describe, it, expect } from "vitest";
import { markDormantByQuota, FREE_ALERT_LIMIT, splitAlertsByQuota } from "../src/lib/alertQuota";

/**
 * A marca que a tela usa para não mentir.
 *
 * O `splitAlertsByQuota` fechou o vazamento de receita (alerta além da cota
 * parou de disparar) e, ao fechá-lo, abriu um buraco de comunicação: a barra
 * lateral continuava listando **todos** os alertas sob o título "Alertas
 * ativos". Para quem assinou, criou vários e deixou vencer, isso é uma
 * afirmação positiva e falsa — e feita justamente à pessoa mais provável de
 * renovar, que precisa entender por que parou de receber e-mail.
 *
 * O que este arquivo tranca:
 *
 *   1. a marca existe e é **booleana em todo alerta** (ausência de campo faria
 *      a tela ter de adivinhar);
 *   2. ela concorda, alerta por alerta, com o que o job semanal realmente faz —
 *      se um dia divergirem, a tela volta a mentir, só que ao contrário;
 *   3. a ordem recebida é preservada, porque a lista já vem ordenada para a UI.
 */

function alerta(id: string, user_id: string, created_at?: string | null) {
  return { id, user_id, created_at };
}

/** Como o `listFuelAlerts` devolve: do mais antigo para o mais novo. */
const tresDoMesmoDono = [
  alerta("a1", "u1", "2026-01-01T00:00:00Z"),
  alerta("a2", "u1", "2026-02-01T00:00:00Z"),
  alerta("a3", "u1", "2026-03-01T00:00:00Z"),
];

describe("markDormantByQuota — assinante", () => {
  it("nenhum alerta é dormente para quem tem plano ativo", () => {
    const marcados = markDormantByQuota(tresDoMesmoDono, true);

    expect(marcados.map((a) => a.dormant)).toEqual([false, false, false]);
  });
});

describe("markDormantByQuota — plano gratuito", () => {
  it("marca como dormente tudo o que passa da cota", () => {
    const marcados = markDormantByQuota(tresDoMesmoDono, false);

    const ativos = marcados.filter((a) => !a.dormant);
    expect(ativos).toHaveLength(FREE_ALERT_LIMIT);
    expect(marcados.filter((a) => a.dormant)).toHaveLength(3 - FREE_ALERT_LIMIT);
  });

  it("o que sobrevive é o mais antigo — a mesma escolha do job", () => {
    // Previsibilidade é o ponto: a pessoa consegue dizer qual dos alertas dela
    // ainda avisa sem abrir o banco nem ler o código.
    const marcados = markDormantByQuota(tresDoMesmoDono, false);

    expect(marcados.find((a) => a.id === "a1")?.dormant).toBe(false);
    expect(marcados.find((a) => a.id === "a3")?.dormant).toBe(true);
  });

  it("um alerta só nunca é dormente — o gratuito tem direito a esse", () => {
    const marcados = markDormantByQuota([alerta("a1", "u1", "2026-01-01T00:00:00Z")], false);

    expect(marcados[0].dormant).toBe(false);
  });

  it("lista vazia não quebra e não inventa alerta", () => {
    expect(markDormantByQuota([], false)).toEqual([]);
  });
});

describe("a tela e o job contam a mesma história", () => {
  /**
   * O teste que mais importa deste arquivo.
   *
   * Dois caminhos diferentes decidem "este alerta dispara?": o job semanal
   * (`splitAlertsByQuota`) e a resposta da API (`markDormantByQuota`). Eles
   * compartilham a implementação hoje — este teste é o que impede alguém de
   * "otimizar" um dos dois e criar a divergência sem perceber, que é como uma
   * tela volta a mentir.
   */
  it("dormant=true corresponde exatamente ao conjunto que o job pula", () => {
    const { skipped } = splitAlertsByQuota(tresDoMesmoDono, new Set());
    const idsPuladosPeloJob = new Set(skipped.map((a) => a.id));

    const idsMarcadosNaTela = new Set(
      markDormantByQuota(tresDoMesmoDono, false)
        .filter((a) => a.dormant)
        .map((a) => a.id)
    );

    expect(idsMarcadosNaTela).toEqual(idsPuladosPeloJob);
  });

  it("vale também com vários donos misturados na mesma lista", () => {
    // Não é o caso da rota (que filtra por usuário), mas a função é genérica e
    // a garantia precisa valer para ela, não para o uso de hoje.
    const misto = [
      alerta("a1", "u1", "2026-01-01T00:00:00Z"),
      alerta("b1", "u2", "2026-01-05T00:00:00Z"),
      alerta("a2", "u1", "2026-02-01T00:00:00Z"),
      alerta("b2", "u2", "2026-02-05T00:00:00Z"),
    ];

    const { skipped } = splitAlertsByQuota(misto, new Set());
    const doJob = new Set(skipped.map((a) => a.id));
    const daTela = new Set(
      markDormantByQuota(misto, false)
        .filter((a) => a.dormant)
        .map((a) => a.id)
    );

    expect(daTela).toEqual(doJob);
  });
});

describe("a lista chega à tela na ordem em que saiu do banco", () => {
  it("marcar não reordena", () => {
    // `listFuelAlerts` ordena por `created_at` ascendente e a barra lateral
    // conta com isso. Reordenar aqui embaralharia a tela a cada carregamento.
    const marcados = markDormantByQuota(tresDoMesmoDono, false);

    expect(marcados.map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
  });

  it("preserva os campos originais do alerta", () => {
    const comExtras = [{ ...alerta("a1", "u1", "2026-01-01T00:00:00Z"), threshold_price: 5.49 }];

    const [marcado] = markDormantByQuota(comExtras, false);

    expect(marcado.threshold_price).toBe(5.49);
    expect(marcado.created_at).toBe("2026-01-01T00:00:00Z");
  });
});
