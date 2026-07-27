import { describe, it, expect } from "vitest";
import { avaliarAlvo, parseAlvo } from "./alertThreshold";

describe("parseAlvo", () => {
  it("aceita vírgula e ponto como separador decimal", () => {
    expect(parseAlvo("6,50")).toBe(6.5);
    expect(parseAlvo("6.50")).toBe(6.5);
  });

  it("devolve null para entrada não numérica ou vazia", () => {
    expect(parseAlvo("abc")).toBeNull();
    expect(parseAlvo("   ")).toBeNull();
  });
});

describe("avaliarAlvo", () => {
  const precoAtual = 6.41;

  it("avisa quando o alvo já está acima do preço atual (o caso do 1º teste real)", () => {
    const r = avaliarAlvo("9", precoAtual);
    expect(r.tipo).toBe("ja-atingido");
    if (r.tipo === "ja-atingido") {
      expect(r.mensagem).toContain("R$ 6,410");
      expect(r.mensagem).toMatch(/imediatamente/i);
    }
  });

  it("avisa também quando o alvo é exatamente o preço atual", () => {
    expect(avaliarAlvo("6,41", precoAtual).tipo).toBe("ja-atingido");
  });

  it("aprova alvo abaixo do preço atual (alerta de queda futura)", () => {
    expect(avaliarAlvo("5,90", precoAtual).tipo).toBe("ok");
  });

  it("rejeita valor inválido ou não positivo", () => {
    expect(avaliarAlvo("abc", precoAtual).tipo).toBe("invalido");
    expect(avaliarAlvo("0", precoAtual).tipo).toBe("invalido");
    expect(avaliarAlvo("-3", precoAtual).tipo).toBe("invalido");
  });

  it("fica quieto com o campo vazio (não avisa antes de o usuário digitar)", () => {
    expect(avaliarAlvo("", precoAtual).tipo).toBe("vazio");
  });

  it("não avisa quando não há preço para comparar", () => {
    expect(avaliarAlvo("9", null).tipo).toBe("ok");
  });
});
