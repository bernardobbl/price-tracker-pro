import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PriceChart } from "./PriceChart";
import type { PriceHistoryItem } from "../types";

// Mocka o gráfico para não depender do canvas do Chart.js no jsdom.
vi.mock("react-chartjs-2", () => ({
  Line: () => <div data-testid="line-chart" />,
}));

const sample: PriceHistoryItem[] = [
  { date: "2026-01-01T00:00:00.000Z", fullPrice: 100, discountedPrice: 90, currency: "R$", title: "x", url: "" },
];

describe("PriceChart", () => {
  it("mostra mensagem de vazio quando não há dados", () => {
    render(<PriceChart data={[]} />);
    expect(screen.getByText(/Nenhum dado ainda/i)).toBeInTheDocument();
    expect(screen.queryByTestId("line-chart")).not.toBeInTheDocument();
  });

  it("renderiza o gráfico quando há dados", () => {
    render(<PriceChart data={sample} />);
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
  });
});
