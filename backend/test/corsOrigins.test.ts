import { describe, it, expect } from "vitest";
import {
  DEFAULT_ORIGIN,
  isOriginAllowed,
  normalizeOrigin,
  parseAllowedOrigins,
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
