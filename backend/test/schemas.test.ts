import { describe, it, expect } from "vitest";
import {
  createProductSchema,
  createAlertSchema,
  searchQuerySchema,
} from "../src/schemas/requestSchemas";

describe("createProductSchema", () => {
  it("aceita produto válido", () => {
    const r = createProductSchema.safeParse({ id: "ps5", name: "PS5", searchQuery: "PS5" });
    expect(r.success).toBe(true);
  });

  it("rejeita nome vazio", () => {
    const r = createProductSchema.safeParse({ id: "ps5", name: "", searchQuery: "x" });
    expect(r.success).toBe(false);
  });
});

describe("createAlertSchema", () => {
  it("aceita alerta válido", () => {
    const r = createAlertSchema.safeParse({ productId: "ps5", thresholdPrice: 3500 });
    expect(r.success).toBe(true);
  });

  it("rejeita threshold não positivo", () => {
    expect(createAlertSchema.safeParse({ productId: "ps5", thresholdPrice: -1 }).success).toBe(false);
    expect(createAlertSchema.safeParse({ productId: "ps5", thresholdPrice: 0 }).success).toBe(false);
  });

  it("rejeita threshold que não é número", () => {
    expect(createAlertSchema.safeParse({ productId: "ps5", thresholdPrice: "3500" }).success).toBe(false);
  });
});

describe("searchQuerySchema", () => {
  it("exige q não vazio", () => {
    expect(searchQuerySchema.safeParse({ q: "" }).success).toBe(false);
    expect(searchQuerySchema.safeParse({}).success).toBe(false);
  });

  it("aceita q válido", () => {
    expect(searchQuerySchema.safeParse({ q: "ps5" }).success).toBe(true);
  });
});
