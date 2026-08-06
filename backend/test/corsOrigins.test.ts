import { describe, it, expect } from "vitest";
import {
  DEFAULT_ORIGIN,
  isOriginAllowed,
  normalizeOrigin,
  parseAllowedOrigins,
  publicAppUrl,
} from "../src/lib/corsOrigins";

describe("parseAllowedOrigins", () => {
  it("cai no localhost quando FRONTEND_URL está ausente ou vazio", () => {
    expect(parseAllowedOrigins(undefined)).toEqual([DEFAULT_ORIGIN]);
    expect(parseAllowedOrigins("   ")).toEqual([DEFAULT_ORIGIN]);
  });

  it("aceita uma única origem", () => {
    expect(parseAllowedOrigins("https://app.vercel.app")).toEqual(["https://app.vercel.app"]);
  });

  it("aceita lista separada por vírgula, com espaços", () => {
    expect(parseAllowedOrigins("https://app.vercel.app, http://localhost:5173")).toEqual([
      "https://app.vercel.app",
      "http://localhost:5173",
    ]);
  });

  it("remove a barra final (o header Origin nunca vem com barra)", () => {
    expect(parseAllowedOrigins("https://app.vercel.app/")).toEqual(["https://app.vercel.app"]);
    expect(normalizeOrigin("https://app.vercel.app///")).toBe("https://app.vercel.app");
  });

  it("descarta entradas vazias de vírgula sobrando", () => {
    expect(parseAllowedOrigins("https://a.com,,https://b.com,")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });
});

describe("isOriginAllowed", () => {
  const allowed = parseAllowedOrigins("https://app.vercel.app/, http://localhost:5173");

  it("libera requisição sem Origin (curl, healthcheck, same-origin)", () => {
    expect(isOriginAllowed(undefined, allowed)).toBe(true);
  });

  it("libera origem da lista, com ou sem barra final", () => {
    expect(isOriginAllowed("https://app.vercel.app", allowed)).toBe(true);
    expect(isOriginAllowed("https://app.vercel.app/", allowed)).toBe(true);
    expect(isOriginAllowed("http://localhost:5173", allowed)).toBe(true);
  });

  it("bloqueia origem fora da lista", () => {
    expect(isOriginAllowed("https://evil.com", allowed)).toBe(false);
    // Não basta "começar com" a origem permitida — tem que ser igual.
    expect(isOriginAllowed("https://app.vercel.app.evil.com", allowed)).toBe(false);
    // Protocolo diferente também não passa.
    expect(isOriginAllowed("http://app.vercel.app", allowed)).toBe(false);
  });
});

/**
 * `publicAppUrl` existe por causa de um bug que ainda não tinha acontecido —
 * mas que estava armado em três e-mails diferentes.
 *
 * `FRONTEND_URL` aceita lista separada por vírgula (é assim que se libera o
 * domínio principal + previews da Vercel + localhost). Só que o alerta de
 * preço, o aviso de vencimento e o comprovante de pagamento jogavam o valor
 * CRU dentro do texto do e-mail. Bastava alguém acrescentar uma segunda origem
 * — coisa que o próprio `.env.example` mostra como exemplo — para todo link
 * enviado virar `https://a.com,http://localhost:5173/premium`.
 */
describe("publicAppUrl", () => {
  it("com uma origem só, devolve ela mesma", () => {
    expect(publicAppUrl("https://precos-combustivel-br.vercel.app")).toBe(
      "https://precos-combustivel-br.vercel.app"
    );
  });

  it("com lista, devolve a PRIMEIRA — a regra é a principal vir na frente", () => {
    expect(publicAppUrl("https://app.vercel.app,http://localhost:5173")).toBe(
      "https://app.vercel.app"
    );
  });

  it("tira a barra final, que a Vercel mostra e quebraria o link montado", () => {
    // Sem isto, o e-mail sairia com `https://app.vercel.app//premium`.
    expect(publicAppUrl("https://app.vercel.app/")).toBe("https://app.vercel.app");
  });

  it("sem a variável, cai no localhost em vez de devolver undefined", () => {
    // Um `undefined` viraria "undefined/premium" dentro de um e-mail real.
    expect(publicAppUrl(undefined)).toBe(DEFAULT_ORIGIN);
    expect(publicAppUrl("   ")).toBe(DEFAULT_ORIGIN);
  });
});
