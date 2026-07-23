import { describe, it, expect } from "vitest";
import {
  createTrackedSeriesSchema,
  createFuelAlertSchema,
  fuelSeriesQuerySchema,
  fuelLocationsQuerySchema,
} from "../src/schemas/requestSchemas";

const UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("fuelSeriesQuerySchema", () => {
  it("aceita produto + UF (2 letras) + município", () => {
    const r = fuelSeriesQuerySchema.safeParse({
      product: "GASOLINA",
      state: "SP",
      municipality: "SAO PAULO",
    });
    expect(r.success).toBe(true);
  });

  it("aceita bandeira opcional", () => {
    const r = fuelSeriesQuerySchema.safeParse({
      product: "ETANOL",
      state: "BA",
      municipality: "SALVADOR",
      brand: "VIBRA",
    });
    expect(r.success).toBe(true);
  });

  it("rejeita UF que não tem 2 letras", () => {
    expect(
      fuelSeriesQuerySchema.safeParse({ product: "GASOLINA", state: "SAO", municipality: "X" }).success
    ).toBe(false);
  });

  it("rejeita produto ou município vazios", () => {
    expect(fuelSeriesQuerySchema.safeParse({ product: "", state: "SP", municipality: "X" }).success).toBe(false);
    expect(fuelSeriesQuerySchema.safeParse({ product: "GASOLINA", state: "SP", municipality: "" }).success).toBe(false);
  });
});

describe("fuelLocationsQuerySchema", () => {
  it("aceita sem UF (lista de estados)", () => {
    expect(fuelLocationsQuerySchema.safeParse({}).success).toBe(true);
  });

  it("aceita UF de 2 letras e rejeita tamanho diferente", () => {
    expect(fuelLocationsQuerySchema.safeParse({ state: "RJ" }).success).toBe(true);
    expect(fuelLocationsQuerySchema.safeParse({ state: "RIO" }).success).toBe(false);
  });
});

describe("createTrackedSeriesSchema", () => {
  it("aceita favorito válido", () => {
    const r = createTrackedSeriesSchema.safeParse({
      product: "GASOLINA",
      state: "SP",
      municipality: "SAO PAULO",
    });
    expect(r.success).toBe(true);
  });

  it("rejeita UF inválida", () => {
    expect(
      createTrackedSeriesSchema.safeParse({ product: "GASOLINA", state: "S", municipality: "X" }).success
    ).toBe(false);
  });
});

describe("createFuelAlertSchema", () => {
  it("aceita alerta válido (seriesId UUID + threshold positivo)", () => {
    const r = createFuelAlertSchema.safeParse({ seriesId: UUID, thresholdPrice: 5.5 });
    expect(r.success).toBe(true);
  });

  it("rejeita seriesId que não é UUID", () => {
    expect(createFuelAlertSchema.safeParse({ seriesId: "abc", thresholdPrice: 5.5 }).success).toBe(false);
  });

  it("rejeita threshold não positivo ou não numérico", () => {
    expect(createFuelAlertSchema.safeParse({ seriesId: UUID, thresholdPrice: 0 }).success).toBe(false);
    expect(createFuelAlertSchema.safeParse({ seriesId: UUID, thresholdPrice: -1 }).success).toBe(false);
    expect(createFuelAlertSchema.safeParse({ seriesId: UUID, thresholdPrice: "5" }).success).toBe(false);
  });
});
