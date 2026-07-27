import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app";

describe("API", () => {
  it("GET /health responde ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /api/fuel/products retorna a lista canônica", async () => {
    const res = await request(app).get("/api/fuel/products");
    expect(res.status).toBe(200);
    expect(res.body).toContain("GASOLINA");
    expect(res.body).toContain("ETANOL");
  });

  // Regressão: GLP chegou a ser oferecido no seletor, mas o ingestor descarta os
  // arquivos de GLP (escopo automotivo) — quem escolhesse caía num estado vazio.
  it("GET /api/fuel/products não oferece combustível que o ETL não ingere (GLP)", async () => {
    const res = await request(app).get("/api/fuel/products");
    expect(res.body).not.toContain("GLP");
  });

  it("GET /api/fuel/series sem parâmetros retorna 400 padronizado", async () => {
    const res = await request(app).get("/api/fuel/series");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });

  it("GET /api/fuel/series com UF inválida retorna 400", async () => {
    const res = await request(app).get("/api/fuel/series?product=GASOLINA&state=SAO&municipality=X");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("GET /api/fuel/locations responde 200 (states quando sem UF)", async () => {
    const res = await request(app).get("/api/fuel/locations");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("states");
  });

  it("POST /api/fuel/tracked sem corpo válido retorna 400", async () => {
    const res = await request(app).post("/api/fuel/tracked").send({ product: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("POST /api/fuel/alerts com seriesId não-UUID retorna 400", async () => {
    const res = await request(app)
      .post("/api/fuel/alerts")
      .send({ seriesId: "nao-uuid", thresholdPrice: 5.5 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("DELETE /api/fuel/tracked/:id com id não-UUID retorna 400", async () => {
    const res = await request(app).delete("/api/fuel/tracked/123");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("GET /api/fuel/alerts responde 200 (lista vazia em dev sem auth)", async () => {
    const res = await request(app).get("/api/fuel/alerts");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
