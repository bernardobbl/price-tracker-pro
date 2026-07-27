import { describe, it, expect } from "vitest";
import { lerSerieDaUrl } from "./seriesFromUrl";

describe("lerSerieDaUrl", () => {
  it("lê a série do link enviado no email de alerta", () => {
    expect(lerSerieDaUrl("?produto=GASOLINA&uf=SP&municipio=SAO%20PAULO")).toEqual({
      product: "GASOLINA",
      state: "SP",
      municipality: "SAO PAULO",
      brand: null,
    });
  });

  it("normaliza para maiúsculas (o banco guarda assim)", () => {
    const s = lerSerieDaUrl("?produto=gasolina&uf=sp&municipio=sao paulo");
    expect(s).toMatchObject({ product: "GASOLINA", state: "SP", municipality: "SAO PAULO" });
  });

  it("lê a bandeira quando presente", () => {
    expect(lerSerieDaUrl("?produto=ETANOL&uf=RJ&municipio=NITEROI&bandeira=IPIRANGA")?.brand).toBe(
      "IPIRANGA"
    );
  });

  it("devolve null quando falta parâmetro (cai na série padrão)", () => {
    expect(lerSerieDaUrl("?produto=GASOLINA&uf=SP")).toBeNull();
    expect(lerSerieDaUrl("?uf=SP&municipio=SAO PAULO")).toBeNull();
    expect(lerSerieDaUrl("")).toBeNull();
  });

  it("rejeita UF malformada", () => {
    expect(lerSerieDaUrl("?produto=GASOLINA&uf=SAOPAULO&municipio=SAO PAULO")).toBeNull();
  });
});
