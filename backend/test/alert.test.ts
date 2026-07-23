import { describe, it, expect } from "vitest";
import { decideAlertAction } from "../src/lib/alertDecision";

describe("decideAlertAction", () => {
  it("notifica quando o preço atinge o alvo e ainda não foi disparado", () => {
    expect(decideAlertAction(90, 100, false)).toBe("notify");
    expect(decideAlertAction(100, 100, false)).toBe("notify"); // limite inclusivo
  });

  it("não notifica de novo se já foi disparado (anti-spam)", () => {
    expect(decideAlertAction(90, 100, true)).toBe("none");
  });

  it("rearma quando o preço sobe acima do alvo depois de disparado", () => {
    expect(decideAlertAction(110, 100, true)).toBe("reset");
  });

  it("não faz nada quando o preço está acima e nunca foi disparado", () => {
    expect(decideAlertAction(110, 100, false)).toBe("none");
  });

  it("ignora threshold inválido (NaN)", () => {
    expect(decideAlertAction(90, Number.NaN, false)).toBe("none");
  });
});
