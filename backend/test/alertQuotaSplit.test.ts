import { describe, it, expect } from "vitest";
import { splitAlertsByQuota, FREE_ALERT_LIMIT } from "../src/lib/alertQuota";

/**
 * A cota **na hora de disparar**, que durante meses não existiu.
 *
 * O gate do `POST /alerts` só olha para quem está criando um alerta agora. Ele
 * não tem nada a dizer sobre alguém que criou seis enquanto era assinante e
 * deixou a assinatura vencer — e esses seis continuavam sendo enviados por
 * e-mail, toda semana, para sempre. Nenhum teste falhava, nenhum log reclamava:
 * o produto simplesmente entregava de graça a única coisa que cobra.
 *
 * Este arquivo tranca as três decisões que a correção tomou:
 *   1. assinante dispara tudo;
 *   2. gratuito dispara `FREE_ALERT_LIMIT`, e os demais ficam **dormentes**;
 *   3. quais sobrevivem é **previsível** — os mais antigos, sempre.
 */

function alerta(id: string, user_id: string, created_at?: string | null) {
  return { id, user_id, created_at };
}

describe("splitAlertsByQuota — assinante", () => {
  it("dispara todos os alertas de quem tem plano ativo", () => {
    const alerts = [
      alerta("a1", "pago", "2026-01-01T00:00:00Z"),
      alerta("a2", "pago", "2026-02-01T00:00:00Z"),
      alerta("a3", "pago", "2026-03-01T00:00:00Z"),
    ];

    const { kept, skipped } = splitAlertsByQuota(alerts, new Set(["pago"]));

    expect(kept).toHaveLength(3);
    expect(skipped).toHaveLength(0);
  });
});

describe("splitAlertsByQuota — o vazamento que a função existe para fechar", () => {
  it("assinatura vencida deixa só a cota do gratuito disparando", () => {
    // O caso real: seis alertas criados como Premium, assinatura vencida.
    const alerts = [
      alerta("a1", "u1", "2026-01-01T00:00:00Z"),
      alerta("a2", "u1", "2026-02-01T00:00:00Z"),
      alerta("a3", "u1", "2026-03-01T00:00:00Z"),
    ];

    // Conjunto vazio de assinantes = ninguém pagou.
    const { kept, skipped } = splitAlertsByQuota(alerts, new Set());

    expect(kept).toHaveLength(FREE_ALERT_LIMIT);
    expect(skipped).toHaveLength(3 - FREE_ALERT_LIMIT);
  });

  it("não apaga nada — os excedentes ficam dormentes, não perdidos", () => {
    // Distinção que importa: a pessoa pode renovar amanhã, e a configuração
    // dela precisa estar lá quando isso acontecer. Apagar alerta por causa de
    // vencimento seria destruir dado alheio sem pedir.
    const alerts = [alerta("a1", "u1", "2026-01-01T00:00:00Z"), alerta("a2", "u1", "2026-02-01T00:00:00Z")];

    const { kept, skipped } = splitAlertsByQuota(alerts, new Set());

    expect([...kept, ...skipped]).toHaveLength(alerts.length);
  });

  it("renovar devolve os dormentes sem que nada precise ser recriado", () => {
    const alerts = [
      alerta("a1", "u1", "2026-01-01T00:00:00Z"),
      alerta("a2", "u1", "2026-02-01T00:00:00Z"),
      alerta("a3", "u1", "2026-03-01T00:00:00Z"),
    ];

    const vencido = splitAlertsByQuota(alerts, new Set());
    const renovado = splitAlertsByQuota(alerts, new Set(["u1"]));

    expect(vencido.kept).toHaveLength(FREE_ALERT_LIMIT);
    expect(renovado.kept).toHaveLength(3);
  });
});

describe("splitAlertsByQuota — quais sobrevivem", () => {
  it("mantém os mais antigos, que é a ordem que a pessoa consegue prever", () => {
    // Independe da ordem em que o banco devolveu as linhas.
    const alerts = [
      alerta("novo", "u1", "2026-05-01T00:00:00Z"),
      alerta("antigo", "u1", "2026-01-01T00:00:00Z"),
      alerta("meio", "u1", "2026-03-01T00:00:00Z"),
    ];

    const { kept } = splitAlertsByQuota(alerts, new Set());

    expect(kept.map((a) => a.id)).toEqual(["antigo"]);
  });

  it("é determinística no empate — senão cala um alerta diferente a cada semana", () => {
    // Mesma data nos dois: sem desempate por id, a escolha dependeria da ordem
    // de retorno do banco, e a pessoa receberia gasolina numa semana e etanol
    // na outra sem ter mudado nada.
    const mesmaData = "2026-01-01T00:00:00Z";
    const ordemA = [alerta("zzz", "u1", mesmaData), alerta("aaa", "u1", mesmaData)];
    const ordemB = [alerta("aaa", "u1", mesmaData), alerta("zzz", "u1", mesmaData)];

    expect(splitAlertsByQuota(ordemA, new Set()).kept.map((a) => a.id)).toEqual(
      splitAlertsByQuota(ordemB, new Set()).kept.map((a) => a.id)
    );
  });

  it("data ausente vai para o fim da fila, não para a frente", () => {
    // `created_at` nulo não pode virar "o mais antigo de todos" por acidente de
    // parsing — seria o alerta sem data roubando a vaga do alerta principal.
    const alerts = [alerta("semData", "u1", null), alerta("comData", "u1", "2026-06-01T00:00:00Z")];

    const { kept } = splitAlertsByQuota(alerts, new Set());

    expect(kept.map((a) => a.id)).toEqual(["comData"]);
  });
});

describe("splitAlertsByQuota — vários donos", () => {
  it("a cota é por pessoa, não do sistema inteiro", () => {
    const alerts = [
      alerta("a1", "gratuito", "2026-01-01T00:00:00Z"),
      alerta("a2", "gratuito", "2026-02-01T00:00:00Z"),
      alerta("b1", "assinante", "2026-01-01T00:00:00Z"),
      alerta("b2", "assinante", "2026-02-01T00:00:00Z"),
    ];

    const { kept, skipped } = splitAlertsByQuota(alerts, new Set(["assinante"]));

    expect(kept.map((a) => a.id).sort()).toEqual(["a1", "b1", "b2"]);
    expect(skipped.map((a) => a.id)).toEqual(["a2"]);
  });

  it("lista vazia não quebra e não inventa nada", () => {
    expect(splitAlertsByQuota([], new Set())).toEqual({ kept: [], skipped: [] });
  });
});
