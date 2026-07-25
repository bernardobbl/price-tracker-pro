import { describe, it, expect } from "vitest";
import { DEFAULT_RETENTION_MONTHS, parseRetentionMonths } from "../src/services/retentionService";

/**
 * A política de retenção protege o free tier — a regra de parsing precisa ser
 * previsível: ausente/inválido = proteção LIGADA no padrão; só "0" explícito desliga.
 */
describe("parseRetentionMonths", () => {
  it("sem env, usa o padrão (proteção ligada)", () => {
    expect(parseRetentionMonths(undefined)).toBe(DEFAULT_RETENTION_MONTHS);
    expect(parseRetentionMonths("")).toBe(DEFAULT_RETENTION_MONTHS);
    expect(parseRetentionMonths("  ")).toBe(DEFAULT_RETENTION_MONTHS);
  });

  it("aceita um número de meses válido", () => {
    expect(parseRetentionMonths("12")).toBe(12);
    expect(parseRetentionMonths(" 24 ")).toBe(24);
  });

  it("'0' explícito desliga a retenção", () => {
    expect(parseRetentionMonths("0")).toBe(0);
  });

  it("valores inválidos caem no padrão (nunca desligam por acidente)", () => {
    expect(parseRetentionMonths("abc")).toBe(DEFAULT_RETENTION_MONTHS);
    expect(parseRetentionMonths("-3")).toBe(DEFAULT_RETENTION_MONTHS);
    expect(parseRetentionMonths("1.5")).toBe(DEFAULT_RETENTION_MONTHS);
  });
});
