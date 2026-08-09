import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import type { FuelAlert } from "../types";

/**
 * O que a barra lateral diz sobre alertas que **não vão disparar**.
 *
 * Contexto, porque o bug aqui não quebrava nada e por isso durou: quando a cota
 * do plano passou a valer também na hora de disparar (e não só na criação),
 * quem tinha assinado, criado vários alertas e deixado vencer ficou com alertas
 * salvos que nunca mais enviam e-mail. A tela continuou listando todos sob o
 * título **"Alertas ativos"**.
 *
 * Isso é pior do que uma omissão: é uma afirmação positiva e falsa, e ela cai
 * sobre a pessoa que já pagou uma vez — exatamente quem precisa entender o que
 * aconteceu para decidir renovar. O único registro do corte era um `logger.info`
 * do job semanal, visível para quem opera e invisível para quem usa.
 *
 * Estes testes trancam as três coisas que a correção precisa manter:
 *   1. sem dormentes, nada muda (nenhum aviso novo aparecendo à toa);
 *   2. com dormentes, o título para de prometer atividade e o motivo aparece;
 *   3. o alerta que ainda funciona **não** é marcado junto — o aviso perderia o
 *      sentido se pintasse a lista inteira.
 */

function alerta(over: Partial<FuelAlert> = {}): FuelAlert {
  return {
    id: "a1",
    series_id: "s1",
    threshold_price: 5.49,
    currency: "R$",
    enabled: true,
    triggered: false,
    tracked_series: {
      product: "gasolina comum",
      state: "SP",
      municipality: "sao paulo",
      brand: null,
      label: "Gasolina · São Paulo/SP",
    },
    ...over,
  };
}

/** Props mínimas: este arquivo só olha para o painel de alertas. */
function renderSidebar(alerts: FuelAlert[]) {
  return render(
    <Sidebar
      products={[]}
      states={[]}
      municipalities={[]}
      selProduct=""
      selState=""
      selMunicipality=""
      onSelProduct={vi.fn()}
      onSelState={vi.fn()}
      onSelMunicipality={vi.fn()}
      onExplore={vi.fn()}
      canManage
      view={null}
      tracked={[]}
      deletingId={null}
      onOpenView={vi.fn()}
      onDeleteFavorite={vi.fn()}
      alerts={alerts}
      onDeleteAlert={vi.fn()}
    />
  );
}

describe("nenhum alerta dormente — a tela de sempre", () => {
  it('mantém o título "Alertas ativos" quando todos disparam', () => {
    renderSidebar([alerta({ id: "a1", dormant: false })]);

    expect(screen.getByText("Alertas ativos")).toBeInTheDocument();
    expect(screen.queryByText(/não avisa/i)).toBeNull();
  });

  it("trata `dormant` ausente como ativo", () => {
    // Backend antigo (ou resposta sem o campo) não pode fazer a tela acusar
    // alertas de mortos — o erro seria na direção mais assustadora possível.
    renderSidebar([alerta({ id: "a1" })]);

    expect(screen.getByText("Alertas ativos")).toBeInTheDocument();
    expect(screen.queryByText(/não avisa/i)).toBeNull();
  });
});

describe("com alertas dormentes", () => {
  const lista = [
    alerta({ id: "a1", dormant: false }),
    alerta({ id: "a2", dormant: true }),
    alerta({ id: "a3", dormant: true }),
  ];

  it('o título deixa de afirmar que todos estão ativos', () => {
    renderSidebar(lista);

    expect(screen.queryByText("Alertas ativos")).toBeNull();
    expect(screen.getByText("Seus alertas")).toBeInTheDocument();
  });

  it("diz quantos ainda enviam e-mail", () => {
    renderSidebar(lista);

    const aviso = screen.getByRole("status");
    expect(aviso).toHaveTextContent(/plano gratuito envia e-mail de\s*1\s*alerta/i);
  });

  it("promete que nada foi apagado — porque nada foi", () => {
    // O corte deixa os excedentes dormentes, não removidos. Se a tela sugerisse
    // perda de dado, empurraria a pessoa a recriar o que já existe.
    renderSidebar(lista);

    expect(screen.getByRole("status")).toHaveTextContent(/nada foi apagado/i);
  });

  it("oferece o caminho para o Premium, com .html", () => {
    renderSidebar(lista);

    const link = within(screen.getByRole("status")).getByRole("link");
    // A URL curta /premium só existe na Vercel; no vite dev cai no fallback do
    // SPA e o clique parece não fazer nada.
    expect(link).toHaveAttribute("href", "/premium.html");
  });

  it("marca só os dormentes, não a lista inteira", () => {
    renderSidebar(lista);

    expect(screen.getAllByText(/não avisa/i)).toHaveLength(2);
  });

  it("o badge de dormente substitui o de disparado, sem empilhar os dois", () => {
    // "disparado" e "não avisa" juntos no mesmo alerta seriam contraditórios:
    // um diz que o e-mail saiu, o outro que não sai.
    renderSidebar([alerta({ id: "a1", dormant: true, triggered: true })]);

    expect(screen.getByText(/não avisa/i)).toBeInTheDocument();
    expect(screen.queryByText(/disparado/i)).toBeNull();
  });
});
