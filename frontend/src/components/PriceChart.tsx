import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  TimeScale,
  type TooltipItem
} from "chart.js";
import "chartjs-adapter-date-fns";
import { ptBR } from "date-fns/locale";
import { Line } from "react-chartjs-2";
import type { PriceHistoryItem } from "../types";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, TimeScale);

interface PriceChartProps {
  data: PriceHistoryItem[];
}

export function PriceChart({ data }: PriceChartProps) {
  if (!data.length) {
    return <p className="muted">Nenhum dado ainda para este produto.</p>;
  }

  const chartData = {
    labels: data.map((item) => new Date(item.date)),
    datasets: [
      {
        label: "Preço (R$)",
        data: data.map((item) => item.discountedPrice),
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59, 130, 246, 0.2)",
        tension: 0.25,
        pointRadius: 3
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top" as const
      },
      tooltip: {
        callbacks: {
          label: (ctx: TooltipItem<"line">) => {
            const price = ctx.parsed.y;
            if (price == null) return "";
            return `R$ ${price.toFixed(2)}`;
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
        }
      },
      y: {
        ticks: {
          callback: (value: string | number) => `R$ ${value}`
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

