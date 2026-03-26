import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";
import type { ChartData, ChartOptions } from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

interface LineChartProps {
  data: ChartData<"line">;
  options?: ChartOptions<"line">;
  height?: number;
}

export function LineChart({ data, options, height = 300 }: LineChartProps) {
  return (
    <div style={{ height }}>
      <Line
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          ...options,
        }}
      />
    </div>
  );
}

interface BarChartProps {
  data: ChartData<"bar">;
  options?: ChartOptions<"bar">;
  height?: number;
}

export function BarChart({ data, options, height = 300 }: BarChartProps) {
  return (
    <div style={{ height }}>
      <Bar
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          ...options,
        }}
      />
    </div>
  );
}
