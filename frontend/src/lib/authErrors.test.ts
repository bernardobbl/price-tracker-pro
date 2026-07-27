import { describe, it, expect } from "vitest";
import { ERRO_GENERICO, traduzirErroAuth } from "./authErrors";

describe("traduzirErroAuth", () => {
  it("não expõe 'Invalid API key' e deixa claro que a falha é nossa", () => {
    const msg = traduzirErroAuth(new Error("Invalid API key"));
    expect(msg).not.toMatch(/api key/i);
    expect(msg).toMatch(/configuração nosso/i);
  });

  it("traduz credenciais inválidas sem jargão", () => {
    expect(traduzirErroAuth(new Error("Invalid login credentials"))).toBe(
      "Email ou senha incorretos."
    );
  });

  it("orienta quando o email ainda não foi confirmado", () => {
    expect(traduzirErroAuth(new Error("Email not confirmed"))).toMatch(/confirme seu email/i);
  });

  it("sugere entrar quando a conta já existe", () => {
    expect(traduzirErroAuth(new Error("User already registered"))).toMatch(/já existe uma conta/i);
  });

  it("é indiferente a maiúsculas/minúsculas do provedor", () => {
    expect(traduzirErroAuth(new Error("INVALID LOGIN CREDENTIALS"))).toBe(
      "Email ou senha incorretos."
    );
  });

  it("aceita erro em formato de objeto (não só Error)", () => {
    expect(traduzirErroAuth({ message: "Failed to fetch" })).toMatch(/sem conexão/i);
  });

  it("cai na mensagem genérica quando não reconhece — sem vazar o texto original", () => {
    const msg = traduzirErroAuth(new Error("PGRST301: JWT expired at segment 3"));
    expect(msg).toBe(ERRO_GENERICO);
    expect(msg).not.toMatch(/jwt/i);
  });

  it("lida com erro vazio ou desconhecido", () => {
    expect(traduzirErroAuth(null)).toBe(ERRO_GENERICO);
    expect(traduzirErroAuth(undefined)).toBe(ERRO_GENERICO);
    expect(traduzirErroAuth(new Error(""))).toBe(ERRO_GENERICO);
  });
});
