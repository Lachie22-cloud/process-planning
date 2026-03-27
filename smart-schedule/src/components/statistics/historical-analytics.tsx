import { useState, useMemo } from "react";
import { format, getDay, addDays } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Layers,
  Droplets,
  TrendingUp,
  BarChart3,
  Activity,
  Calendar,
  PieChart,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { useResources } from "@/hooks/use-resources";
import {
  useHistoricalBatches,
  type TimeRange,
} from "@/hooks/use-historical-batches";
import { LineChart, BarChart } from "./chart-canvas";
import type { Resource } from "@/types/resource";
import type { ChartData, ChartOptions } from "chart.js";

// ── App chart colours (CSS variable fallbacks for Chart.js) ──
// These match --color-chart-1 … --color-chart-5 from tokens.css
const CHART_COLORS = {
  chart1: "#c0522e", // oklch(0.646 0.222 41.12) → warm orange
  chart2: "#3a8a7a", // oklch(0.6 0.118 184.71) → teal
  chart3: "#2a5a7a", // oklch(0.398 0.07 227.39) → steel blue
  chart4: "#c9a829", // oklch(0.828 0.189 84.43) → gold
  chart5: "#b89030", // oklch(0.769 0.188 70.08) → amber
};

// ── Trunk colours (matching reference) ────────────────────────
const TRUNK_COLORS: Record<string, string> = {
  TK1: "#3B82F6",
  TK2: "#10B981",
  TK3: "#F59E0B",
  TK4: "#EF4444",
  TK5: "#8B5CF6",
  TK6: "#EC4899",
  THINNERS: "#6B7280",
};

function trunkColor(trunk: string | null): string {
  return TRUNK_COLORS[trunk ?? ""] ?? "#9CA3AF";
}

// ── Week-ending helper ────────────────────────────────────────
function getWeekEnding(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const day = getDay(d); // 0=Sun … 5=Fri 6=Sat
  const diff = (5 - day + 7) % 7; // days until Friday
  const friday = addDays(d, diff);
  return format(friday, "yyyy-MM-dd");
}

// ── Heat helpers ──────────────────────────────────────────────
function getHeatColor(val: number, max: number): string {
  if (val === 0) return "var(--color-muted, #f9fafb)";
  const intensity = Math.min(val / (max || 1), 1);
  if (intensity < 0.25) return "#dbeafe";
  if (intensity < 0.5) return "#93c5fd";
  if (intensity < 0.75) return "#3b82f6";
  return "#1e40af";
}

function getHeatText(val: number, max: number): string {
  if (val === 0) return "#d1d5db";
  const intensity = Math.min(val / (max || 1), 1);
  return intensity > 0.5 ? "#ffffff" : "#1f2937";
}

// ── Shared Chart.js defaults ─────────────────────────────────
const CHART_FONT = {
  family: "Inter, system-ui, -apple-system, sans-serif",
  size: 12,
};

function baseChartOptions(
  title: string,
): ChartOptions<"bar"> & ChartOptions<"line"> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top" as const,
        labels: { font: CHART_FONT, padding: 16, usePointStyle: true },
      },
      title: {
        display: false, // We use CardHeader instead
        text: title,
      },
      tooltip: {
        backgroundColor: "rgba(15, 23, 42, 0.9)",
        titleFont: { ...CHART_FONT, weight: "bold" as const },
        bodyFont: CHART_FONT,
        padding: 12,
        cornerRadius: 8,
        displayColors: true,
      },
    },
    scales: {
      x: {
        ticks: { font: CHART_FONT },
        grid: { color: "rgba(0,0,0,0.04)" },
      },
      y: {
        ticks: { font: CHART_FONT },
        grid: { color: "rgba(0,0,0,0.06)" },
        beginAtZero: true,
      },
    },
  };
}

// ── Types ─────────────────────────────────────────────────────
type ChartView =
  | "utilisation"
  | "trends"
  | "trunks"
  | "dispersers"
  | "heatmap"
  | "throughput"
  | "dayofweek"
  | "batchsize"
  | "completion";

interface WeekData {
  batches: number;
  volume: number;
  trunks: Record<string, number>;
  completedCount: number;
  materialIssueCount: number;
}

interface MixerRow {
  id: string;
  name: string;
  trunk: string | null;
  batchCount: number;
  totalVolume: number;
  daysUsed: number;
  totalDays: number;
  utilPct: number;
}

interface DisperserRow {
  id: string;
  name: string;
  batchCount: number;
  totalPMC: number;
  daysUsed: number;
  totalDays: number;
  utilPct: number;
}

// ── Sub-views ─────────────────────────────────────────────────
const VIEW_BUTTONS: { id: ChartView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "utilisation", label: "Mixer Utilisation", icon: BarChart3 },
  { id: "trends", label: "Volume Trends", icon: TrendingUp },
  { id: "trunks", label: "Trunk Analysis", icon: Layers },
  { id: "dispersers", label: "Disperser Usage", icon: Activity },
  { id: "heatmap", label: "Heatmap", icon: PieChart },
  { id: "throughput", label: "Throughput", icon: TrendingUp },
  { id: "dayofweek", label: "Day Patterns", icon: Calendar },
  { id: "batchsize", label: "Batch Sizes", icon: BarChart3 },
  { id: "completion", label: "Completion Rate", icon: CheckCircle2 },
];

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: "2w", label: "2 Weeks" },
  { value: "4w", label: "4 Weeks" },
  { value: "8w", label: "8 Weeks" },
  { value: "all", label: "All Time" },
];

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"];

// ── KPI Card ─────────────────────────────────────────────────
function KpiCard({
  label,
  value,
  icon: Icon,
  colour,
  sub,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  colour?: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-6">
        <Icon className={`h-8 w-8 shrink-0 opacity-80 ${colour ?? "text-foreground"}`} />
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-3xl font-bold">{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Component ─────────────────────────────────────────────────
export function HistoricalAnalytics() {
  const [timeRange, setTimeRange] = useState<TimeRange>("4w");
  const [trunkFilter, setTrunkFilter] = useState("all");
  const [baseFilter, setBaseFilter] = useState("all");
  const [chartView, setChartView] = useState<ChartView>("utilisation");

  const { data: allBatches = [], isLoading } = useHistoricalBatches(timeRange);
  const { data: resources = [] } = useResources();

  // Resource lookup maps
  const resourceMap = useMemo(() => {
    const map = new Map<string, Resource>();
    for (const r of resources) map.set(r.id, r);
    return map;
  }, [resources]);

  const mixers = useMemo(
    () => resources.filter((r) => r.resourceType === "mixer"),
    [resources],
  );
  const dispersers = useMemo(
    () => resources.filter((r) => r.resourceType === "disperser"),
    [resources],
  );
  const allTrunks = useMemo(
    () =>
      [
        ...new Set(
          mixers.map((r) => r.trunkLine).filter(Boolean) as string[],
        ),
      ].sort(),
    [mixers],
  );

  // Filtered batches
  const filteredBatches = useMemo(() => {
    return allBatches.filter((b) => {
      if (trunkFilter !== "all") {
        const res = b.planResourceId ? resourceMap.get(b.planResourceId) : null;
        if (res?.trunkLine !== trunkFilter) return false;
      }
      if (baseFilter !== "all") {
        const res = b.planResourceId ? resourceMap.get(b.planResourceId) : null;
        if (
          res?.chemicalBase?.toUpperCase() !== baseFilter.toUpperCase()
        )
          return false;
      }
      return true;
    });
  }, [allBatches, trunkFilter, baseFilter, resourceMap]);

  const allDates = useMemo(
    () => [...new Set(filteredBatches.map((b) => b.planDate).filter(Boolean) as string[])].sort(),
    [filteredBatches],
  );

  // ── KPI calculations ───────────────────────────────────────
  const totalVolume = useMemo(
    () => filteredBatches.reduce((sum, b) => sum + (b.batchVolume ?? 0), 0),
    [filteredBatches],
  );
  const avgBatchSize = filteredBatches.length > 0 ? Math.round(totalVolume / filteredBatches.length) : 0;
  const completionRate = useMemo(() => {
    if (filteredBatches.length === 0) return 0;
    const completed = filteredBatches.filter((b) => b.status === "Job Complete" || b.status === "Ready to Fill" || b.status === "Filling").length;
    return Math.round((completed / filteredBatches.length) * 100);
  }, [filteredBatches]);
  const topMixer = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of filteredBatches) {
      if (b.planResourceId) {
        counts.set(b.planResourceId, (counts.get(b.planResourceId) ?? 0) + 1);
      }
    }
    let maxId = "";
    let maxCount = 0;
    for (const [id, count] of counts) {
      if (count > maxCount) {
        maxId = id;
        maxCount = count;
      }
    }
    const res = resourceMap.get(maxId);
    return res ? (res.displayName ?? res.resourceCode) : "—";
  }, [filteredBatches, resourceMap]);

  // ── Weekly aggregation ──────────────────────────────────────
  const weeklyData = useMemo(() => {
    const weeks: Record<string, WeekData> = {};
    for (const b of filteredBatches) {
      if (!b.planDate) continue;
      const we = getWeekEnding(b.planDate);
      if (!weeks[we])
        weeks[we] = { batches: 0, volume: 0, trunks: {}, completedCount: 0, materialIssueCount: 0 };
      weeks[we].batches++;
      weeks[we].volume += b.batchVolume ?? 0;
      if (b.status === "Job Complete" || b.status === "Ready to Fill" || b.status === "Filling") weeks[we].completedCount++;
      if (!b.rmAvailable || !b.packagingAvailable) weeks[we].materialIssueCount++;
      const res = b.planResourceId ? resourceMap.get(b.planResourceId) : null;
      const trunk = res?.trunkLine ?? "Other";
      weeks[we].trunks[trunk] = (weeks[we].trunks[trunk] ?? 0) + (b.batchVolume ?? 0);
    }
    return Object.entries(weeks).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredBatches, resourceMap]);

  // ── Mixer utilisation ───────────────────────────────────────
  const mixerUtil = useMemo<MixerRow[]>(() => {
    return mixers
      .filter((m) => m.maxBatchesPerDay <= 1) // exclude pot-style
      .map((mixer) => {
        const mb = filteredBatches.filter(
          (b) => b.planResourceId === mixer.id,
        );
        const totalVol = mb.reduce((s, b) => s + (b.batchVolume ?? 0), 0);
        const daysUsed = new Set(mb.map((b) => b.planDate).filter(Boolean))
          .size;
        const totalDays = allDates.length || 1;
        return {
          id: mixer.id,
          name: mixer.displayName ?? mixer.resourceCode,
          trunk: mixer.trunkLine,
          batchCount: mb.length,
          totalVolume: totalVol,
          daysUsed,
          totalDays,
          utilPct: Math.round((daysUsed / totalDays) * 100),
        };
      })
      .sort((a, b) => b.batchCount - a.batchCount);
  }, [mixers, filteredBatches, allDates]);

  // ── Disperser utilisation ───────────────────────────────────
  const disperserUtil = useMemo<DisperserRow[]>(() => {
    return dispersers
      .map((disp) => {
        const db = filteredBatches.filter(
          (b) => b.planDisperserId === disp.id || b.planDisperser2Id === disp.id,
        );
        const totalPMC = db.reduce((s, b) => s + (b.premixCount || 1), 0);
        const daysUsed = new Set(db.map((b) => b.planDate).filter(Boolean))
          .size;
        const totalDays = allDates.length || 1;
        return {
          id: disp.id,
          name: disp.displayName ?? disp.resourceCode,
          batchCount: db.length,
          totalPMC,
          daysUsed,
          totalDays,
          utilPct: Math.round((daysUsed / totalDays) * 100),
        };
      })
      .sort((a, b) => b.batchCount - a.batchCount);
  }, [dispersers, filteredBatches, allDates]);

  // ── Mixer heatmap ───────────────────────────────────────────
  const mixerHeatmap = useMemo(() => {
    const nonPotMixers = mixers.filter((m) => m.maxBatchesPerDay <= 1);
    const weekLabels = weeklyData.map(([we]) => {
      const d = new Date(we + "T12:00:00");
      return format(d, "d MMM");
    });
    const rows = nonPotMixers.map((mixer) => {
      const cells = weeklyData.map(([we]) => {
        const weDate = new Date(we + "T12:00:00");
        const wsDate = addDays(weDate, -4);
        const wsStr = format(wsDate, "yyyy-MM-dd");
        return filteredBatches
          .filter(
            (b) =>
              b.planResourceId === mixer.id &&
              b.planDate &&
              b.planDate >= wsStr &&
              b.planDate <= we,
          )
          .reduce((s, b) => s + (b.batchVolume ?? 0), 0);
      });
      return {
        name: mixer.displayName ?? mixer.resourceCode,
        trunk: mixer.trunkLine,
        cells,
      };
    });
    return { weekLabels, rows };
  }, [mixers, filteredBatches, weeklyData]);

  const heatmapMax = useMemo(
    () => Math.max(...mixerHeatmap.rows.flatMap((r) => r.cells), 1),
    [mixerHeatmap],
  );

  // ── Day-of-week aggregation ─────────────────────────────────
  const dayOfWeekData = useMemo(() => {
    // 0=Mon..4=Fri
    const dayBuckets: { volume: number; batches: number; count: number }[] = Array.from(
      { length: 5 },
      () => ({ volume: 0, batches: 0, count: 0 }),
    );
    const weekSet = new Set<string>();
    for (const b of filteredBatches) {
      if (!b.planDate) continue;
      const d = new Date(b.planDate + "T12:00:00");
      const jsDay = d.getDay(); // 0=Sun 1=Mon..5=Fri 6=Sat
      if (jsDay >= 1 && jsDay <= 5) {
        const idx = jsDay - 1; // 0=Mon..4=Fri
        const bucket = dayBuckets[idx];
        if (bucket) {
          bucket.volume += b.batchVolume ?? 0;
          bucket.batches++;
        }
        weekSet.add(getWeekEnding(b.planDate));
      }
    }
    const numWeeks = Math.max(weekSet.size, 1);
    return dayBuckets.map((d, i) => ({
      day: DAY_NAMES[i],
      avgVolume: Math.round(d.volume / numWeeks),
      avgBatches: Math.round((d.batches / numWeeks) * 10) / 10,
      totalVolume: d.volume,
      totalBatches: d.batches,
    }));
  }, [filteredBatches]);

  // ── Batch size distribution ─────────────────────────────────
  const batchSizeDist = useMemo(() => {
    const buckets = [
      { label: "0–500L", min: 0, max: 500, count: 0 },
      { label: "500–1,000L", min: 500, max: 1000, count: 0 },
      { label: "1,000–2,000L", min: 1000, max: 2000, count: 0 },
      { label: "2,000–5,000L", min: 2000, max: 5000, count: 0 },
      { label: "5,000–10,000L", min: 5000, max: 10000, count: 0 },
      { label: "10,000L+", min: 10000, max: Infinity, count: 0 },
    ];
    for (const b of filteredBatches) {
      const vol = b.batchVolume ?? 0;
      if (vol <= 0) continue;
      for (const bucket of buckets) {
        if (vol >= bucket.min && vol < bucket.max) {
          bucket.count++;
          break;
        }
      }
    }
    return buckets;
  }, [filteredBatches]);

  // ── Chart data ──────────────────────────────────────────────
  const weekLabels = weeklyData.map(([we]) => {
    const d = new Date(we + "T12:00:00");
    return format(d, "d MMM");
  });

  // Volume Trends
  const volumeTrendData: ChartData<"line"> = {
    labels: weekLabels,
    datasets: [
      {
        label: "Volume (L)",
        data: weeklyData.map(([, d]) => d.volume),
        borderColor: CHART_COLORS.chart3,
        backgroundColor: "rgba(42,90,122,0.08)",
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: CHART_COLORS.chart3,
        yAxisID: "y",
      },
      {
        label: "Batches",
        data: weeklyData.map(([, d]) => d.batches),
        borderColor: CHART_COLORS.chart2,
        backgroundColor: "rgba(58,138,122,0.08)",
        fill: false,
        tension: 0.3,
        pointRadius: 3,
        yAxisID: "y1",
      },
    ],
  };

  const volumeTrendOptions: ChartOptions<"line"> = {
    ...baseChartOptions("Volume & Batch Trend by Week"),
    scales: {
      x: { ticks: { font: CHART_FONT }, grid: { color: "rgba(0,0,0,0.04)" } },
      y: {
        title: { display: true, text: "Volume (L)", font: CHART_FONT },
        beginAtZero: true,
        ticks: { font: CHART_FONT },
        grid: { color: "rgba(0,0,0,0.06)" },
      },
      y1: {
        position: "right" as const,
        title: { display: true, text: "Batches", font: CHART_FONT },
        beginAtZero: true,
        ticks: { font: CHART_FONT },
        grid: { drawOnChartArea: false },
      },
    },
  };

  // Trunk Stacked Bar
  const trunkTrendData: ChartData<"bar"> = {
    labels: weekLabels,
    datasets: allTrunks.map((trunk) => ({
      label: trunk,
      data: weeklyData.map(([, d]) => d.trunks[trunk] ?? 0),
      backgroundColor: trunkColor(trunk),
    })),
  };

  const trunkTrendOptions: ChartOptions<"bar"> = {
    ...baseChartOptions("Volume by Trunk per Week"),
    scales: {
      x: { stacked: true, ticks: { font: CHART_FONT }, grid: { color: "rgba(0,0,0,0.04)" } },
      y: {
        stacked: true,
        title: { display: true, text: "Volume (L)", font: CHART_FONT },
        beginAtZero: true,
        ticks: { font: CHART_FONT },
        grid: { color: "rgba(0,0,0,0.06)" },
      },
    },
  };

  // Mixer Utilisation Bar
  const top20Mixers = mixerUtil.filter((m) => m.batchCount > 0).slice(0, 20);
  const mixerBarData: ChartData<"bar"> = {
    labels: top20Mixers.map((m) => m.name),
    datasets: [
      {
        label: "Total Volume (L)",
        data: top20Mixers.map((m) => m.totalVolume),
        backgroundColor: top20Mixers.map((m) => trunkColor(m.trunk)),
        borderRadius: 4,
      },
    ],
  };

  const mixerBarOptions: ChartOptions<"bar"> = {
    ...baseChartOptions("Volume per Mixer"),
    indexAxis: "y" as const,
    plugins: {
      ...baseChartOptions("Volume per Mixer").plugins,
      legend: { display: false },
    },
    scales: {
      x: {
        title: { display: true, text: "Volume (L)", font: CHART_FONT },
        beginAtZero: true,
        ticks: { font: CHART_FONT },
        grid: { color: "rgba(0,0,0,0.06)" },
      },
      y: {
        ticks: { font: CHART_FONT },
        grid: { display: false },
      },
    },
  };

  // Disperser Bar
  const activeDispersers = disperserUtil.filter((d) => d.batchCount > 0);
  const disperserBarData: ChartData<"bar"> = {
    labels: activeDispersers.map((d) => d.name),
    datasets: [
      {
        label: "Batches",
        data: activeDispersers.map((d) => d.batchCount),
        backgroundColor: CHART_COLORS.chart3,
        borderRadius: 4,
      },
      {
        label: "Total PMC",
        data: activeDispersers.map((d) => d.totalPMC),
        backgroundColor: CHART_COLORS.chart4,
        borderRadius: 4,
      },
    ],
  };

  const disperserBarOptions: ChartOptions<"bar"> = {
    ...baseChartOptions("Disperser Usage: Batches & PMC Load"),
    scales: {
      x: { ticks: { font: CHART_FONT }, grid: { color: "rgba(0,0,0,0.04)" } },
      y: { beginAtZero: true, ticks: { font: CHART_FONT }, grid: { color: "rgba(0,0,0,0.06)" } },
    },
  };

  // Throughput Trend (new)
  const throughputData: ChartData<"line"> = {
    labels: weekLabels,
    datasets: [
      {
        label: "Avg Batches/Day",
        data: weeklyData.map(([, d]) => {
          // Assume 5 working days per week
          return Math.round((d.batches / 5) * 10) / 10;
        }),
        borderColor: CHART_COLORS.chart1,
        backgroundColor: "rgba(192,82,46,0.08)",
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: CHART_COLORS.chart1,
        yAxisID: "y",
      },
      {
        label: "Avg Volume/Day (L)",
        data: weeklyData.map(([, d]) => Math.round(d.volume / 5)),
        borderColor: CHART_COLORS.chart2,
        backgroundColor: "rgba(58,138,122,0.08)",
        fill: false,
        tension: 0.3,
        pointRadius: 3,
        yAxisID: "y1",
      },
    ],
  };

  const throughputOptions: ChartOptions<"line"> = {
    ...baseChartOptions("Daily Throughput Trend"),
    scales: {
      x: { ticks: { font: CHART_FONT }, grid: { color: "rgba(0,0,0,0.04)" } },
      y: {
        title: { display: true, text: "Batches/Day", font: CHART_FONT },
        beginAtZero: true,
        ticks: { font: CHART_FONT },
        grid: { color: "rgba(0,0,0,0.06)" },
      },
      y1: {
        position: "right" as const,
        title: { display: true, text: "Volume/Day (L)", font: CHART_FONT },
        beginAtZero: true,
        ticks: { font: CHART_FONT },
        grid: { drawOnChartArea: false },
      },
    },
  };

  // Day-of-Week Pattern (new)
  const dayOfWeekChartData: ChartData<"bar"> = {
    labels: DAY_NAMES,
    datasets: [
      {
        label: "Avg Volume (L)",
        data: dayOfWeekData.map((d) => d.avgVolume),
        backgroundColor: CHART_COLORS.chart3,
        borderRadius: 4,
        yAxisID: "y",
      },
      {
        label: "Avg Batches",
        data: dayOfWeekData.map((d) => d.avgBatches),
        backgroundColor: CHART_COLORS.chart4,
        borderRadius: 4,
        yAxisID: "y1",
      },
    ],
  };

  const dayOfWeekOptions: ChartOptions<"bar"> = {
    ...baseChartOptions("Average Production by Day of Week"),
    scales: {
      x: { ticks: { font: CHART_FONT }, grid: { display: false } },
      y: {
        title: { display: true, text: "Avg Volume (L)", font: CHART_FONT },
        beginAtZero: true,
        ticks: { font: CHART_FONT },
        grid: { color: "rgba(0,0,0,0.06)" },
      },
      y1: {
        position: "right" as const,
        title: { display: true, text: "Avg Batches", font: CHART_FONT },
        beginAtZero: true,
        ticks: { font: CHART_FONT },
        grid: { drawOnChartArea: false },
      },
    },
  };

  // Batch Size Distribution (new)
  const batchSizeChartData: ChartData<"bar"> = {
    labels: batchSizeDist.map((b) => b.label),
    datasets: [
      {
        label: "Number of Batches",
        data: batchSizeDist.map((b) => b.count),
        backgroundColor: [
          CHART_COLORS.chart3,
          CHART_COLORS.chart2,
          CHART_COLORS.chart4,
          CHART_COLORS.chart1,
          CHART_COLORS.chart5,
          "#6B7280",
        ],
        borderRadius: 4,
      },
    ],
  };

  const batchSizeOptions: ChartOptions<"bar"> = {
    ...baseChartOptions("Batch Size Distribution"),
    plugins: {
      ...baseChartOptions("Batch Size Distribution").plugins,
      legend: { display: false },
    },
    scales: {
      x: { ticks: { font: CHART_FONT }, grid: { display: false } },
      y: {
        title: { display: true, text: "Count", font: CHART_FONT },
        beginAtZero: true,
        ticks: { font: CHART_FONT, stepSize: 1 },
        grid: { color: "rgba(0,0,0,0.06)" },
      },
    },
  };

  // Completion Rate Trend (new)
  const completionTrendData: ChartData<"line"> = {
    labels: weekLabels,
    datasets: [
      {
        label: "Completion Rate (%)",
        data: weeklyData.map(([, d]) =>
          d.batches > 0 ? Math.round((d.completedCount / d.batches) * 100) : 0,
        ),
        borderColor: CHART_COLORS.chart2,
        backgroundColor: "rgba(58,138,122,0.1)",
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: CHART_COLORS.chart2,
        yAxisID: "y",
      },
      {
        label: "Material Issues",
        data: weeklyData.map(([, d]) => d.materialIssueCount),
        borderColor: CHART_COLORS.chart1,
        backgroundColor: "rgba(192,82,46,0.08)",
        fill: false,
        tension: 0.3,
        pointRadius: 3,
        borderDash: [5, 5],
        yAxisID: "y1",
      },
    ],
  };

  const completionTrendOptions: ChartOptions<"line"> = {
    ...baseChartOptions("Completion Rate & Material Issues"),
    scales: {
      x: { ticks: { font: CHART_FONT }, grid: { color: "rgba(0,0,0,0.04)" } },
      y: {
        title: { display: true, text: "Completion %", font: CHART_FONT },
        beginAtZero: true,
        max: 100,
        ticks: { font: CHART_FONT },
        grid: { color: "rgba(0,0,0,0.06)" },
      },
      y1: {
        position: "right" as const,
        title: { display: true, text: "Material Issues", font: CHART_FONT },
        beginAtZero: true,
        ticks: { font: CHART_FONT },
        grid: { drawOnChartArea: false },
      },
    },
  };

  // ── Loading ─────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-16" />
        <Skeleton className="h-10" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* KPI Summary Row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          icon={Layers}
          label="Total Batches"
          value={filteredBatches.length.toLocaleString()}
          sub={`${allDates.length} production days`}
        />
        <KpiCard
          icon={Droplets}
          label="Total Volume"
          value={`${totalVolume.toLocaleString()}L`}
          sub={`${weeklyData.length} weeks`}
        />
        <KpiCard
          icon={TrendingUp}
          label="Avg Batch Size"
          value={`${avgBatchSize.toLocaleString()}L`}
          sub={`Top mixer: ${topMixer}`}
        />
        <KpiCard
          icon={BarChart3}
          label="Completion Rate"
          value={`${completionRate}%`}
          colour="text-emerald-600"
          sub="Complete / Ready to Fill / Filling"
        />
      </div>

      {/* Filters Bar */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Time Range
            </p>
            <div className="inline-flex rounded-lg bg-muted p-1">
              {TIME_RANGES.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setTimeRange(o.value)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                    timeRange === o.value
                      ? "bg-background text-foreground shadow"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Trunk
            </p>
            <Select value={trunkFilter} onValueChange={setTrunkFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Trunks</SelectItem>
                {allTrunks.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Base Type
            </p>
            <Select value={baseFilter} onValueChange={setBaseFilter}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="SOLVENT">Solvent</SelectItem>
                <SelectItem value="WATER">Water</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 font-medium">
              {filteredBatches.length} batches
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 font-medium">
              {allDates.length} days
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 font-medium">
              {weeklyData.length} weeks
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Chart View Selector */}
      <Tabs value={chartView} onValueChange={(v) => setChartView(v as ChartView)}>
        <TabsList className="flex-wrap h-auto gap-1 p-1">
          {VIEW_BUTTONS.map((v) => (
            <TabsTrigger key={v.id} value={v.id} className="gap-1.5">
              <v.icon className="h-3.5 w-3.5" />
              {v.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* === MIXER UTILISATION === */}
      {chartView === "utilisation" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Volume per Mixer</CardTitle>
              <p className="text-sm text-muted-foreground">
                Total litres produced per mixer, coloured by trunk line.
              </p>
            </CardHeader>
            <CardContent>
              <BarChart
                data={mixerBarData}
                options={mixerBarOptions}
                height={460}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mixer Detail</CardTitle>
              <p className="text-sm text-muted-foreground">
                Batch count, volume, and utilisation rate for each mixer.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mixer</TableHead>
                      <TableHead>Trunk</TableHead>
                      <TableHead className="text-center">Batches</TableHead>
                      <TableHead className="text-right">Volume (L)</TableHead>
                      <TableHead className="text-center">Days Used</TableHead>
                      <TableHead className="w-40">Utilisation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mixerUtil.map((m) => (
                      <TableRow
                        key={m.id}
                        className={
                          m.batchCount === 0 ? "opacity-40" : undefined
                        }
                      >
                        <TableCell className="font-medium">{m.name}</TableCell>
                        <TableCell>
                          <TrunkBadge trunk={m.trunk} />
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {m.batchCount}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {m.totalVolume.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-center">
                          {m.daysUsed} / {m.totalDays}
                        </TableCell>
                        <TableCell>
                          <UtilBar pct={m.utilPct} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* === VOLUME TRENDS === */}
      {chartView === "trends" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Volume & Batch Trend</CardTitle>
              <p className="text-sm text-muted-foreground">
                Weekly total volume and batch count over the selected period.
              </p>
            </CardHeader>
            <CardContent>
              <LineChart
                data={volumeTrendData}
                options={volumeTrendOptions}
                height={360}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Weekly Summary</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Week Ending</TableHead>
                      <TableHead className="text-center">Batches</TableHead>
                      <TableHead className="text-right">Volume (L)</TableHead>
                      <TableHead className="text-right">Avg Batch (L)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {weeklyData.map(([we, d]) => (
                      <TableRow key={we}>
                        <TableCell className="font-medium">
                          {format(new Date(we + "T12:00:00"), "d MMM yyyy")}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {d.batches}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {d.volume.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {d.batches > 0
                            ? Math.round(d.volume / d.batches).toLocaleString()
                            : 0}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* === TRUNK ANALYSIS === */}
      {chartView === "trunks" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Volume by Trunk per Week</CardTitle>
              <p className="text-sm text-muted-foreground">
                Stacked weekly volume breakdown across trunk lines.
              </p>
            </CardHeader>
            <CardContent>
              <BarChart
                data={trunkTrendData}
                options={trunkTrendOptions}
                height={410}
              />
            </CardContent>
          </Card>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            {allTrunks.map((trunk) => {
              const trunkBatches = filteredBatches.filter((b) => {
                const res = b.planResourceId
                  ? resourceMap.get(b.planResourceId)
                  : null;
                return res?.trunkLine === trunk;
              });
              const vol = trunkBatches.reduce(
                (s, b) => s + (b.batchVolume ?? 0),
                0,
              );
              if (trunkBatches.length === 0) return null;
              return (
                <Card key={trunk}>
                  <CardContent className="p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <TrunkBadge trunk={trunk} />
                      <span className="text-sm text-muted-foreground">
                        {trunkBatches.length} batches
                      </span>
                    </div>
                    <p className="text-2xl font-bold">
                      {vol.toLocaleString()}L
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Avg:{" "}
                      {Math.round(vol / trunkBatches.length).toLocaleString()}L
                      per batch
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* === DISPERSER USAGE === */}
      {chartView === "dispersers" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Disperser Batches & PMC Load</CardTitle>
              <p className="text-sm text-muted-foreground">
                Number of batches and total pre-mix cycles per disperser.
              </p>
            </CardHeader>
            <CardContent>
              <BarChart
                data={disperserBarData}
                options={disperserBarOptions}
                height={360}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Disperser Detail</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Disperser</TableHead>
                      <TableHead className="text-center">Batches</TableHead>
                      <TableHead className="text-center">Total PMC</TableHead>
                      <TableHead className="text-center">Days Used</TableHead>
                      <TableHead className="w-40">Utilisation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {disperserUtil.map((d) => (
                      <TableRow
                        key={d.id}
                        className={
                          d.batchCount === 0 ? "opacity-40" : undefined
                        }
                      >
                        <TableCell className="font-medium">{d.name}</TableCell>
                        <TableCell className="text-center tabular-nums">
                          {d.batchCount}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {d.totalPMC}
                        </TableCell>
                        <TableCell className="text-center">
                          {d.daysUsed} / {d.totalDays}
                        </TableCell>
                        <TableCell>
                          <UtilBar pct={d.utilPct} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* === HEATMAP === */}
      {chartView === "heatmap" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mixer Volume Heatmap</CardTitle>
            <p className="text-sm text-muted-foreground">
              Litres produced per mixer per week. Darker cells indicate higher volume.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 z-10 min-w-[90px] bg-background">
                      Mixer
                    </TableHead>
                    {mixerHeatmap.weekLabels.map((wl, i) => (
                      <TableHead
                        key={i}
                        className="px-1 text-center font-normal"
                        style={{
                          writingMode: "vertical-rl",
                          minWidth: "32px",
                          height: "60px",
                        }}
                      >
                        {wl}
                      </TableHead>
                    ))}
                    <TableHead className="sticky right-0 z-10 bg-background text-center">
                      Total
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mixerHeatmap.rows.map((row) => {
                    const rowTotal = row.cells.reduce((s, c) => s + c, 0);
                    if (
                      rowTotal === 0 &&
                      trunkFilter === "all" &&
                      baseFilter === "all"
                    )
                      return null;
                    return (
                      <TableRow key={row.name}>
                        <TableCell className="sticky left-0 z-10 border-r border-border bg-background font-medium">
                          <div className="flex items-center gap-1">
                            <span
                              className="inline-block h-2 w-2 rounded"
                              style={{
                                backgroundColor: trunkColor(row.trunk),
                              }}
                            />
                            <span className="text-xs">{row.name}</span>
                          </div>
                        </TableCell>
                        {row.cells.map((val, ci) => (
                          <TableCell
                            key={ci}
                            className="border border-border/30 p-0 text-center"
                            title={`${row.name}: ${val.toLocaleString()}L`}
                            style={{
                              backgroundColor: getHeatColor(val, heatmapMax),
                              color: getHeatText(val, heatmapMax),
                              minWidth: "32px",
                              fontSize: "9px",
                              padding: "3px 1px",
                            }}
                          >
                            {val > 0
                              ? val >= 1000
                                ? `${(val / 1000).toFixed(0)}k`
                                : val
                              : ""}
                          </TableCell>
                        ))}
                        <TableCell className="sticky right-0 z-10 border-l border-border bg-background text-center font-bold tabular-nums text-xs">
                          {rowTotal > 0
                            ? `${(rowTotal / 1000).toFixed(0)}k`
                            : "-"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {/* Legend */}
            <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
              <span>Volume:</span>
              <div className="flex gap-0.5">
                {[0, 0.25, 0.5, 0.75, 1].map((i) => (
                  <div
                    key={i}
                    className="h-4 w-6 rounded"
                    style={{
                      backgroundColor: getHeatColor(i * heatmapMax, heatmapMax),
                    }}
                  />
                ))}
              </div>
              <span>Low &rarr; High</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* === THROUGHPUT TREND (NEW) === */}
      {chartView === "throughput" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Daily Throughput Trend</CardTitle>
              <p className="text-sm text-muted-foreground">
                Average batches and volume per working day, tracked week by week.
                Spot production efficiency changes over time.
              </p>
            </CardHeader>
            <CardContent>
              <LineChart
                data={throughputData}
                options={throughputOptions}
                height={360}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Weekly Throughput Summary</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Week Ending</TableHead>
                      <TableHead className="text-center">Total Batches</TableHead>
                      <TableHead className="text-right">Total Volume (L)</TableHead>
                      <TableHead className="text-center">Avg Batches/Day</TableHead>
                      <TableHead className="text-right">Avg Volume/Day (L)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {weeklyData.map(([we, d]) => (
                      <TableRow key={we}>
                        <TableCell className="font-medium">
                          {format(new Date(we + "T12:00:00"), "d MMM yyyy")}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {d.batches}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {d.volume.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {(Math.round((d.batches / 5) * 10) / 10).toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {Math.round(d.volume / 5).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* === DAY-OF-WEEK PATTERN (NEW) === */}
      {chartView === "dayofweek" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Average Production by Day of Week</CardTitle>
              <p className="text-sm text-muted-foreground">
                Identifies which weekdays are consistently busiest. Useful for balancing
                workload and planning resource allocation.
              </p>
            </CardHeader>
            <CardContent>
              <BarChart
                data={dayOfWeekChartData}
                options={dayOfWeekOptions}
                height={320}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Day-of-Week Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Day</TableHead>
                      <TableHead className="text-right">Avg Volume (L)</TableHead>
                      <TableHead className="text-center">Avg Batches</TableHead>
                      <TableHead className="text-right">Total Volume (L)</TableHead>
                      <TableHead className="text-center">Total Batches</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dayOfWeekData.map((d) => (
                      <TableRow key={d.day}>
                        <TableCell className="font-medium">{d.day}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {d.avgVolume.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {d.avgBatches}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {d.totalVolume.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {d.totalBatches}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* === BATCH SIZE DISTRIBUTION (NEW) === */}
      {chartView === "batchsize" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Batch Size Distribution</CardTitle>
              <p className="text-sm text-muted-foreground">
                Histogram of batch volumes showing the mix of small, medium, and large batches.
                Helps understand production patterns and equipment utilisation.
              </p>
            </CardHeader>
            <CardContent>
              <BarChart
                data={batchSizeChartData}
                options={batchSizeOptions}
                height={320}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Size Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Size Range</TableHead>
                      <TableHead className="text-center">Count</TableHead>
                      <TableHead className="text-right">% of Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batchSizeDist.map((bucket) => (
                      <TableRow key={bucket.label}>
                        <TableCell className="font-medium">{bucket.label}</TableCell>
                        <TableCell className="text-center tabular-nums">
                          {bucket.count}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {filteredBatches.length > 0
                            ? `${Math.round((bucket.count / filteredBatches.length) * 100)}%`
                            : "0%"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* === COMPLETION RATE TREND (NEW) === */}
      {chartView === "completion" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Completion Rate & Material Issues</CardTitle>
              <p className="text-sm text-muted-foreground">
                Tracks the percentage of batches reaching &ldquo;Complete&rdquo; status per week,
                overlaid with material shortage counts. Helps identify supply chain bottlenecks.
              </p>
            </CardHeader>
            <CardContent>
              <LineChart
                data={completionTrendData}
                options={completionTrendOptions}
                height={360}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Weekly Completion Summary</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Week Ending</TableHead>
                      <TableHead className="text-center">Batches</TableHead>
                      <TableHead className="text-center">Completed</TableHead>
                      <TableHead className="text-center">Rate</TableHead>
                      <TableHead className="text-center">Material Issues</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {weeklyData.map(([we, d]) => {
                      const rate = d.batches > 0 ? Math.round((d.completedCount / d.batches) * 100) : 0;
                      return (
                        <TableRow key={we}>
                          <TableCell className="font-medium">
                            {format(new Date(we + "T12:00:00"), "d MMM yyyy")}
                          </TableCell>
                          <TableCell className="text-center tabular-nums">
                            {d.batches}
                          </TableCell>
                          <TableCell className="text-center tabular-nums">
                            {d.completedCount}
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={cn(
                              "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                              rate >= 80
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                                : rate >= 50
                                  ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                                  : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
                            )}>
                              {rate}%
                            </span>
                          </TableCell>
                          <TableCell className="text-center tabular-nums">
                            {d.materialIssueCount > 0 ? (
                              <span className="text-amber-600">{d.materialIssueCount}</span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Shared tiny components ────────────────────────────────────
function TrunkBadge({ trunk }: { trunk: string | null }) {
  if (!trunk) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-xs font-bold text-white"
      style={{ backgroundColor: trunkColor(trunk) }}
    >
      {trunk}
    </span>
  );
}

function UtilBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            pct > 80
              ? "bg-emerald-500"
              : pct > 40
                ? "bg-amber-400"
                : pct > 0
                  ? "bg-red-400"
                  : "bg-muted",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-right text-xs font-medium tabular-nums">
        {pct}%
      </span>
    </div>
  );
}
