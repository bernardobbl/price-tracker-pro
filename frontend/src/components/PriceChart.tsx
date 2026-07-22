import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  TimeScale,
  type ScriptableContext,
  type TooltipItem
} from "chart.js";
import "chartjs-adapter-date-fns";
import { ptBR } from "date-fns/locale";
import { Line } from "react-chartjs-2";
import type { PriceHistoryItem } from "../types";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  TimeScale
);

interface PriceChartProps {
  data: PriceHistoryItem[];
}

/** Gradiente vertical translúcido sob a linha (do azul ao transparente). */
function makeGradient(ctx: ScriptableContext<"line">): CanvasGradient | string {
  const { chart } = ctx;
  const { ctx: canvas, chartArea } = chart;
  if (!chartArea) return "rgba(59, 130, 246, 0.15)";
  const gradient = canvas.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  gradient.addColorStop(0, "rgba(59, 130, 246, 0.35)");
  gradient.addColorStop(1, "rgba(59, 130, 246, 0.02)");
  return gradient;
}

export function PriceChart({ data }: PriceChartProps) {
  if (!data.length) {
    return <p className="muted">Nenhum dado ainda para este produto.</p>;
  }

  const currency = data[0]?.currency ?? "R$";
  const prices = data.map((item) => item.discountedPrice);
  const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;

  const chartData = {
    labels: data.map((item) => new Date(item.date)),
    datasets: [
      {
        label: "Preço",
        data: prices,
        borderColor: "#3b82f6",
        backgroundColor: makeGradient,
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: "#3b82f6",
        pointHoverBorderColor: "#0f172a",
        pointHoverBorderWidth: 2,
        borderWidth: 2,
        order: 1
      },
      {
        label: "Média do período",
        data: prices.map(() => avg),
        borderColor: "rgba(148, 163, 184, 0.55)",
        borderDash: [5, 5],
        borderWidth: 1,
        pointRadius: 0,
        pointHoverRadius: 0,
        fill: false,
        order: 2
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "index" as const,
      intersect: false
    },
    plugins: {
      legend: {
        position: "top" as const,
        labels: {
          color: "#94a3b8",
          usePointStyle: true,
          boxWidth: 8,
          boxHeight: 8,
          padding: 16
        }
      },
      tooltip: {
        backgroundColor: "rgba(15, 23, 42, 0.95)",
        borderColor: "rgba(148, 163, 184, 0.2)",
        borderWidth: 1,
        titleColor: "#e5e7eb",
        bodyColor: "#cbd5e1",
        padding: 10,
        displayColors: true,
        callbacks: {
          title: (items: TooltipItem<"line">[]) => {
            const first = items[0];
            if (!first || first.parsed.x == null) return "";
            const d = new Date(first.parsed.x);
            return d.toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "short",
              year: "numeric"
            });
          },
          label: (ctx: TooltipItem<"line">) => {
            const price = ctx.parsed.y;
            if (price == null) return "";
            const prefix = ctx.datasetIndex === 1 ? "Média: " : "Preço: ";
            return `${prefix}${currency} ${price.toFixed(2)}`;
          }
        }
      }
    },
    scales: {
      x: {
        type: "time" as const,
        time: {
          unit: "day" as const
        },
        adapters: {
          date: {
            locale: ptBR
          }
        },
        grid: {
          color: "rgba(148, 163, 184, 0.06)"
        },
        ticks: {
          color: "#64748b",
          maxTicksLimit: 6
        }
      },
      y: {
        grid: {
          color: "rgba(148, 163, 184, 0.08)"
        },
        ticks: {
          color: "#64748b",
          callback: (value: string | number) => `${currency} ${value}`
        }
      }
    }
  };

  return (
    <div className="chart-container">
      <Line data={chartData} options={options} />
    </div>
  );
}
