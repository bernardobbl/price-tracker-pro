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

// Paleta do tema claro editorial (espelha os tokens do index.css).
const INK = "#20222e";
const BRAND = "#3b4a8c";
const CAMEL = "#b08a4b";
const GRID = "rgba(212, 210, 200, 0.55)";
const TICK = "#6e7180";
const SURFACE = "#ffffff";
const LINE = "#e4e2da";

/** Gradiente vertical translúcido sob a linha (índigo → transparente). */
function makeGradient(ctx: ScriptableContext<"line">): CanvasGradient | string {
  const { chart } = ctx;
  const { ctx: canvas, chartArea } = chart;
  if (!chartArea) return "rgba(59, 74, 140, 0.12)";
  const gradient = canvas.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  gradient.addColorStop(0, "rgba(59, 74, 140, 0.16)");
  gradient.addColorStop(1, "rgba(59, 74, 140, 0.01)");
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
        borderColor: INK,
        backgroundColor: makeGradient,
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: BRAND,
        pointHoverBorderColor: SURFACE,
        pointHoverBorderWidth: 2,
        borderWidth: 2,
        order: 1
      },
      {
        label: "Média do período",
        data: prices.map(() => avg),
        borderColor: CAMEL,
        borderDash: [5, 5],
        borderWidth: 1.5,
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
          color: TICK,
          usePointStyle: true,
          boxWidth: 8,
          boxHeight: 8,
          padding: 16
        }
      },
      tooltip: {
        backgroundColor: SURFACE,
        borderColor: LINE,
        borderWidth: 1,
        titleColor: INK,
        bodyColor: TICK,
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
          color: GRID,
          display: false
        },
        ticks: {
          color: TICK,
          maxTicksLimit: 6
        }
      },
      y: {
        grid: {
          color: GRID
        },
        ticks: {
          color: TICK,
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
