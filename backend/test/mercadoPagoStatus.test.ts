import { describe, it, expect } from "vitest";
import { normalizeOrderStatus } from "../src/services/mercadoPagoClient";

/**
 * Esta função decide se alguém ganha acesso pago. Um status novo caindo no
 * balde errado é caro nos dois sentidos: liberar sem pagamento, ou não liberar
 * quem pagou. Por isso o default é `pending` — diante do desconhecido, não
 * liberamos nada e o caso aparece no polling em vez de virar acesso indevido.
 */
describe("normalizeOrderStatus", () => {
  it("reconhece os status que significam PAGO", () => {
    for (const s of ["processed", "paid", "approved", "accredited"]) {
      expect(normalizeOrderStatus(s)).toBe("paid");
    }
  });

  it("é indiferente a maiúsculas", () => {
    expect(normalizeOrderStatus("PROCESSED")).toBe("paid");
    expect(normalizeOrderStatus("Approved")).toBe("paid");
  });

  it("reconhece expirado", () => {
    expect(normalizeOrderStatus("expired")).toBe("expired");
  });

  it("reconhece cancelado, com as duas grafias de 'cancelled'", () => {
    expect(normalizeOrderStatus("cancelled")).toBe("cancelled");
    expect(normalizeOrderStatus("canceled")).toBe("cancelled");
    expect(normalizeOrderStatus("rejected")).toBe("cancelled");
  });

  it("reconhece estorno e chargeback", () => {
    expect(normalizeOrderStatus("refunded")).toBe("refunded");
    expect(normalizeOrderStatus("charged_back")).toBe("refunded");
  });

  it("trata os status de espera como pendente", () => {
    expect(normalizeOrderStatus("action_required")).toBe("pending");
    expect(normalizeOrderStatus("processing")).toBe("pending");
    expect(normalizeOrderStatus("pending")).toBe("pending");
  });

  it("FALHA FECHADO: status desconhecido nunca libera acesso", () => {
    expect(normalizeOrderStatus("status_que_ainda_nao_existe")).toBe("pending");
    expect(normalizeOrderStatus("")).toBe("pending");
    expect(normalizeOrderStatus(undefined)).toBe("pending");
    expect(normalizeOrderStatus(null)).toBe("pending");
  });
});
