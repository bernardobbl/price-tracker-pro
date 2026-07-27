/**
 * Conteúdo do email de alerta.
 *
 * Estes testes travam as duas correções que só apareceram quando o alerta rodou
 * em produção pela primeira vez: o link apontava para a ANP em vez do app, e o
 * texto afirmava que o preço "atingiu o valor desejado" mesmo quando estava muito
 * abaixo do alvo — descrevendo um evento que não aconteceu.
 */

import { describe, it, expect } from "vitest";
import {
  formatarPreco,
  montarConteudoAlerta,
  montarLinkDaSerie,
  type SeriesRef,
} from "../src/lib/alertEmailContent";

const serie: SeriesRef = {
  product: "GASOLINA",
  state: "SP",
  municipality: "SAO PAULO",
  brand: null,
  label: "Gasolina · São Paulo/SP",
};

const APP = "https://precos-combustivel-br.vercel.app";

describe("montarLinkDaSerie", () => {
  it("aponta para o app, na série do alerta", () => {
    const link = montarLinkDaSerie(APP, serie);
    expect(link).toContain("precos-combustivel-br.vercel.app");
    expect(link).toContain("produto=GASOLINA");
    expect(link).toContain("uf=SP");
    expect(link).toContain("municipio=SAO+PAULO");
  });

  it("nunca aponta para a ANP (era o link antigo, inútil para o usuário)", () => {
    expect(montarLinkDaSerie(APP, serie)).not.toContain("gov.br");
  });

  it("usa a primeira origem quando FRONTEND_URL tem lista separada por vírgula", () => {
    const link = montarLinkDaSerie(`${APP}, http://localhost:5173`, serie);
    expect(link?.startsWith(APP)).toBe(true);
  });

  it("normaliza barra final", () => {
    expect(montarLinkDaSerie(`${APP}/`, serie)).toContain(`${APP}/?`);
  });

  it("inclui bandeira quando a série tem uma", () => {
    expect(montarLinkDaSerie(APP, { ...serie, brand: "IPIRANGA" })).toContain("bandeira=IPIRANGA");
  });

  it("devolve null sem app configurado (email sai sem link, não quebra)", () => {
    expect(montarLinkDaSerie(undefined, serie)).toBeNull();
    expect(montarLinkDaSerie("  ", serie)).toBeNull();
  });
});

describe("montarConteudoAlerta", () => {
  it("não afirma que o preço 'atingiu' o alvo quando está bem abaixo", () => {
    const { text, subject } = montarConteudoAlerta({
      series: serie,
      thresholdPrice: 9,
      currentPrice: 6.41,
      appUrl: APP,
    });
    expect(text).not.toMatch(/atingiu/i);
    expect(subject).toMatch(/abaixo do seu alvo/i);
    // Explicita a distância: era o que faltava para o email fazer sentido.
    // (9 − 6,41) / 9 = 28,8% → arredonda para 29%.
    expect(text).toMatch(/29%/);
    expect(text).toContain("R$ 2,590"); // quanto está abaixo, em reais
  });

  it("diferencia o caso de estar exatamente no alvo", () => {
    const { text } = montarConteudoAlerta({
      series: serie,
      thresholdPrice: 6.4,
      currentPrice: 6.4,
      appUrl: APP,
    });
    expect(text).toMatch(/exatamente no alvo/i);
    expect(text).not.toMatch(/%/);
  });

  it("mostra os dois valores em formato brasileiro", () => {
    const { text } = montarConteudoAlerta({
      series: serie,
      thresholdPrice: 7,
      currentPrice: 6.412,
      appUrl: APP,
    });
    expect(text).toContain("R$ 6,412");
    expect(text).toContain("R$ 7,000");
  });

  it("não duplica o nome da série (o email antigo repetia o rótulo)", () => {
    const { subject } = montarConteudoAlerta({
      series: serie,
      thresholdPrice: 9,
      currentPrice: 6.41,
      appUrl: APP,
    });
    const ocorrencias = subject.split(serie.label).length - 1;
    expect(ocorrencias).toBe(1);
  });

  it("inclui a data do levantamento quando disponível", () => {
    const { text } = montarConteudoAlerta({
      series: serie,
      thresholdPrice: 9,
      currentPrice: 6.41,
      appUrl: APP,
      collectedAt: "2026-06-30",
    });
    expect(text).toContain("30/06/2026");
  });

  it("funciona sem app configurado (sem link, sem quebrar)", () => {
    const { text } = montarConteudoAlerta({ series: serie, thresholdPrice: 9, currentPrice: 6.41 });
    expect(text).toContain("R$ 6,410");
    expect(text).not.toMatch(/https?:\/\//);
  });
});

describe("formatarPreco", () => {
  it("usa vírgula decimal e 3 casas (padrão de combustível)", () => {
    expect(formatarPreco(6.4)).toBe("R$ 6,400");
    expect(formatarPreco(6.4123)).toBe("R$ 6,412");
  });
});
