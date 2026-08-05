import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanBadge } from "./PlanBadge";
import type { Entitlement } from "../types";

/**
 * O selo é a única prova, dentro do app, de que a assinatura existe. Antes dele
 * quem pagava voltava para o dashboard e não via diferença nenhuma.
 */

const premium = (over: Partial<Entitlement> = {}): Entitlement => ({
  active: true,
  plan: "anual",
  expiresAt: "2027-08-04T10:00:00Z",
  daysLeft: 300,
  ...over,
});

describe("PlanBadge", () => {
  it("não aparece para quem não está logado", () => {
    const { container } = render(<PlanBadge entitlement={null} logged={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("quem não tem plano vê o caminho para o Premium", () => {
    render(<PlanBadge entitlement={null} logged />);
    const link = screen.getByRole("link");
    // Com .html: a URL curta /premium só existe na Vercel; no vite dev ela cai
    // no fallback do SPA e o clique não leva a lugar nenhum.
    expect(link).toHaveAttribute("href", "/premium.html");
    expect(link).toHaveTextContent(/gratuito/i);
  });

  it("assinante com folga vê o selo com a data de validade", () => {
    render(<PlanBadge entitlement={premium()} logged />);
    expect(screen.getByText(/Premium até/)).toBeInTheDocument();
    // Sem link: não há o que fazer, é só confirmação.
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("dentro da janela de 8 dias vira aviso com caminho para renovar", () => {
    render(<PlanBadge entitlement={premium({ daysLeft: 5 })} logged />);
    const link = screen.getByRole("link");
    expect(link).toHaveTextContent(/vence em 5 dias/i);
    expect(link).toHaveTextContent(/renovar/i);
  });

  it("usa singular no último dia", () => {
    render(<PlanBadge entitlement={premium({ daysLeft: 1 })} logged />);
    expect(screen.getByRole("link")).toHaveTextContent(/vence em 1 dia\b/i);
  });

  it("no dia do vencimento não diz '0 dias'", () => {
    render(<PlanBadge entitlement={premium({ daysLeft: 0 })} logged />);
    expect(screen.getByRole("link")).toHaveTextContent(/menos de 1 dia/i);
  });

  it("assinatura sem data não quebra o selo", () => {
    render(<PlanBadge entitlement={premium({ expiresAt: null, daysLeft: null })} logged />);
    expect(screen.getByText("Premium")).toBeInTheDocument();
  });
});
