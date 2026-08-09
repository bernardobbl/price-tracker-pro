import { describe, it, expect } from "vitest";
import { checkSignupEmail } from "./emailValidation";

describe("checkSignupEmail", () => {
  it("aceita endereços normais", () => {
    for (const ok of [
      "usuario.exemplo@gmail.com",
      "alguem@empresa.com.br",
      "nome.sobrenome+tag@dominio.io",
      "a@b.co",
    ]) {
      expect(checkSignupEmail(ok), ok).toEqual({ valid: true, problem: null, message: "" });
    }
  });

  it("recusa domínio sem TLD — o caso que aconteceu de verdade", () => {
    // Uma conta foi criada assim em 23/jul/2026 e nunca recebeu email nenhum.
    const r = checkSignupEmail("usuario.exemplo@gmail");
    expect(r.valid).toBe(false);
    expect(r.problem).toBe("sem-tld");
    // A mensagem sugere a correção provável em vez de só dizer "inválido".
    expect(r.message).toContain("usuario.exemplo@gmail.com");
  });

  it("recusa TLD que não é alfabético", () => {
    expect(checkSignupEmail("alguem@dominio.123").problem).toBe("sem-tld");
    expect(checkSignupEmail("alguem@dominio.c").problem).toBe("sem-tld");
  });

  it("recusa campo vazio ou só espaços", () => {
    expect(checkSignupEmail("").problem).toBe("vazio");
    expect(checkSignupEmail("   ").problem).toBe("vazio");
  });

  it("recusa espaço no meio", () => {
    expect(checkSignupEmail("alguem @gmail.com").problem).toBe("formato");
  });

  it("recusa zero ou mais de um @", () => {
    expect(checkSignupEmail("semarroba.com").problem).toBe("formato");
    expect(checkSignupEmail("a@b@c.com").problem).toBe("formato");
  });

  it("recusa parte local vazia e domínio vazio", () => {
    expect(checkSignupEmail("@gmail.com").problem).toBe("formato");
    expect(checkSignupEmail("alguem@").problem).toBe("sem-dominio");
  });

  it("recusa pontos malformados no domínio", () => {
    expect(checkSignupEmail("alguem@.com").problem).toBe("formato");
    expect(checkSignupEmail("alguem@gmail..com").problem).toBe("formato");
    expect(checkSignupEmail("alguem@gmail.com.").problem).toBe("formato");
  });

  it("ignora espaço em volta, como qualquer campo colado", () => {
    expect(checkSignupEmail("  alguem@gmail.com  ").valid).toBe(true);
  });
});
