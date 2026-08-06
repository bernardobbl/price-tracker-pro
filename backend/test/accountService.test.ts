/**
 * Direitos do titular (LGPD art. 18).
 *
 * O teste que mais importa aqui é o do **conflito**: a Política de Privacidade
 * promete apagar os dados *e* guardar os registros de pagamento por 5 anos. O
 * código só cumpre as duas coisas se anonimizar em vez de deletar — e a ordem
 * (anonimizar antes de remover o usuário) é o que impede o registro fiscal de
 * ser levado junto.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1", email: "alguem@exemplo.com", created_at: "2026-07-01T00:00:00Z" } as
    | { id: string; email: string; created_at: string }
    | null,
  rows: {
    tracked_series: [{ id: "t1", label: "Gasolina · São Paulo/SP" }] as unknown[],
    alerts: [{ id: "a1", threshold_price: 5.5 }] as unknown[],
    subscriptions: [{ id: "s1", amount_cents: 5990 }] as unknown[],
    billing_charges: [{ id: "c1", amount_cents: 5990 }] as unknown[],
  } as Record<string, unknown[]>,
  /** Assinaturas ativas devolvidas na checagem prévia da exclusão. */
  ativas: [] as unknown[],
  /** Ordem real das operações — é o que prova a sequência. */
  ops: [] as string[],
  updateError: null as { message: string } | null,
  deleteUserError: null as { message: string } | null,
  deleteUser: vi.fn(async () => ({ error: h.deleteUserError })),
}));

vi.mock("../src/config/supabaseClient", () => {
  function makeBuilder(table: string) {
    let op = "select";
    let contouAtivas = false;

    const result = () => {
      if (op === "update") {
        h.ops.push(`anonimiza:${table}`);
        return { data: h.updateError ? null : h.rows[table], error: h.updateError };
      }
      if (contouAtivas) return { data: h.ativas, error: null };
      return { data: h.rows[table] ?? [], error: null };
    };

    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        // `.eq("status", "active")` só aparece na checagem de assinatura válida.
        if (col === "status" && val === "active") contouAtivas = true;
        return builder;
      },
      gt: () => builder,
      update: () => {
        op = "update";
        return builder;
      },
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return builder;
  }

  return {
    supabase: {
      from: (t: string) => makeBuilder(t),
      auth: {
        admin: {
          getUserById: async () => ({ data: { user: h.user }, error: h.user ? null : { message: "não existe" } }),
          deleteUser: async (id: string) => {
            h.ops.push(`removeUsuario:${id}`);
            return h.deleteUser();
          },
        },
      },
    },
  };
});

import { exportUserData, deleteAccount, AccountError } from "../src/services/accountService";

beforeEach(() => {
  h.ops = [];
  h.ativas = [];
  h.updateError = null;
  h.deleteUserError = null;
  h.user = { id: "u1", email: "alguem@exemplo.com", created_at: "2026-07-01T00:00:00Z" };
  h.deleteUser.mockClear();
});

describe("exportUserData", () => {
  it("entrega conta, favoritos, alertas, assinaturas e cobranças", async () => {
    const dump = await exportUserData("u1");

    expect(dump.conta).toEqual({
      id: "u1",
      email: "alguem@exemplo.com",
      criadaEm: "2026-07-01T00:00:00Z",
    });
    expect(dump.favoritos).toHaveLength(1);
    expect(dump.alertas).toHaveLength(1);
    // Dado de pagamento é do titular e vai junto: esconder a parte que mais
    // importa numa disputa não é "formato legível".
    expect(dump.assinaturas).toHaveLength(1);
    expect(dump.cobrancas).toHaveLength(1);
  });

  it("avisa que preço da ANP não entra, porque é dado público sobre postos", async () => {
    const dump = await exportUserData("u1");
    expect(dump.aviso).toContain("ANP");
  });

  it("recusa conta inexistente", async () => {
    h.user = null;
    await expect(exportUserData("u1")).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
  });
});

describe("deleteAccount", () => {
  it("anonimiza o registro fiscal ANTES de remover o usuário", async () => {
    await deleteAccount("u1");

    // A ordem é a garantia: invertida, o delete levaria (ou desvincularia sem
    // registro) a linha de receita que a política promete guardar por 5 anos.
    expect(h.ops).toEqual([
      "anonimiza:subscriptions",
      "anonimiza:billing_charges",
      "removeUsuario:u1",
    ]);
  });

  it("relata quantas linhas de receita ficaram anônimas", async () => {
    const r = await deleteAccount("u1");
    expect(r.assinaturasAnonimizadas).toBe(1);
    expect(r.cobrancasAnonimizadas).toBe(1);
  });

  // Depois de `user_id = null`, nenhuma busca por pessoa alcança a cobrança, e
  // o `previewRefund` só trabalha por `chargeId`. Devolver os ids aqui é o que
  // torna possível o pedido de reembolso que a resposta promete — sem eles, a
  // promessa é verdadeira no papel e inexequível na prática.
  it("devolve os ids das cobranças — a única alça que sobra para pedir reembolso", async () => {
    const r = await deleteAccount("u1");
    expect(r.cobrancasParaReembolso).toEqual(["c1"]);
  });

  it("sinaliza quando a pessoa estava abrindo mão de acesso já pago", async () => {
    h.ativas = [{ id: "s1" }];
    const r = await deleteAccount("u1");
    expect(r.tinhaAssinaturaAtiva).toBe(true);
  });

  it("não remove o usuário se a anonimização falhar", async () => {
    h.updateError = { message: "coluna não aceita null" };

    await expect(deleteAccount("u1")).rejects.toBeInstanceOf(AccountError);
    expect(h.ops).not.toContain("removeUsuario:u1");
  });

  it("falha alto quando o registro foi anonimizado mas o usuário não saiu", async () => {
    h.deleteUserError = { message: "admin API fora" };

    await expect(deleteAccount("u1")).rejects.toMatchObject({ code: "DELETE_FAILED" });
    // O estado intermediário existe e é recuperável — o que não pode é passar calado.
    expect(h.ops).toContain("anonimiza:subscriptions");
  });
});
