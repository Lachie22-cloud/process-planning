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
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/cn";
import { useResources } from "@/hooks/use-resources";
import {
  useHistoricalBatches,
  type TimeRange,
} from "@/hooks/use-historical-batches";
import { LineChart, BarChart } from "./chart-canvas";
import type { Batch } from "@/types/batch";
import type { Resource } from "@/types/resource";
import type { ChartData, ChartOptions } from "chart.js";

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

// ── Types ─────────────────────────────────────────────────────
type ChartView =
  | "utilisation"
  | "trends"
  | "trunks"
  | "dispersers"
  | "heatmap";

interface WeekData {
  batches: number;
  volume: number;
  items: number;
  trunks: Record<string, number>;
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
const VIEW_BUTTONS: { id: ChartView; label: string }[] = [
  { id: "utilisation", label: "Mixer Utilisation" },
  { id: "trends", label: "Volume Trends" },
  { id: "trunks", label: "Trunk Analysis" },
  { id: "dispersers", label: "Disperser Usage" },
  { id: "heatmap", label: "Heatmap" },
];

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: "2w", label: "2 Weeks" },
  { value: "4w", label: "4 Weeks" },
  { value: "8w", label: "8 Weeks" },
  { value: "all", label: "All Time" },
];

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

  // ── Weekly aggregation ──────────────────────────────────────
  const weeklyData = useMemo(() => {
    const weeks: Record<string, WeekData> = {};
    for (const b of filteredBatches) {
      if (!b.planDate) continue;
      const we = getWeekEnding(b.planDate);
      if (!weeks[we])
        weeks[we] = { batches: 0, volume: 0, items: 0, trunks: {} };
      weeks[we].batches++;
      weeks[we].volume += b.batchVolume ?? 0;
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
          (b) => b.planDisperserId === disp.id,
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

  // ── Chart data ──────────────────────────────────────────────
  const weekLabels = weeklyData.map(([we]) => {
    const d = new Date(we + "T12:00:00");
    return format(d, "d MMM");
  });

  const volumeTrendData: ChartData<"line"> = {
    labels: weekLabels,
    datasets: [
      {
        label: "Volume (L)",
        data: weeklyData.map(([, d]) => d.volume),
        borderColor: "#005CA9",
        backgroundColor: "rgba(0,92,169,0.1)",
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: "#005CA9",
        yAxisID: "y",
      },
      {
        label: "Batches",
        data: weeklyData.map(([, d]) => d.batches),
        borderColor: "#10B981",
        backgroundColor: "rgba(16,185,129,0.1)",
        fill: false,
        tension: 0.3,
        pointRadius: 3,
        yAxisID: "y1",
      },
    ],
  };

  const volumeTrendOptions: ChartOptions<"line"> = {
    plugins: {
      legend: { position: "top" as const },
      title: { display: true, text: "Volume & Batch Trend by Week" },
    },
    scales: {
      y: {
        title: { display: true, text: "Volume (L)" },
        beginAtZero: true,
      },
      y1: {
        position: "right" as const,
        title: { display: true, text: "Batches" },
        beginAtZero: true,
        grid: { drawOnChartArea: false },
      },
    },
  };

  const trunkTrendData: ChartData<"bar"> = {
    labels: weekLabels,
    datasets: allTrunks.map((trunk) => ({
      label: trunk,
      data: weeklyData.map(([, d]) => d.trunks[trunk] ?? 0),
      backgroundColor: trunkColor(trunk),
    })),
  };

  const trunkTrendOptions: ChartOptions<"bar"> = {
    plugins: {
      legend: { position: "top" as const },
      title: { display: true, text: "Volume by Trunk per Week (Stacked)" },
    },
    scales: {
      x: { stacked: true },
      y: {
        stacked: true,
        title: { display: true, text: "Volume (L)" },
        beginAtZero: true,
      },
    },
  };

  const top20Mixers = mixerUtil.filter((m) => m.batchCount > 0).slice(0, 20);
  const mixerBarData: ChartData<"bar"> = {
    labels: top20Mixers.map((m) => m.name),
    datasets: [
      {
        label: "Total Volume (L)",
        data: top20Mixers.map((m) => m.totalVolume),
        backgroundColor: top20Mixers.map((m) => trunkColor(m.trunk)),
      },
    ],
  };

  const mixerBarOptions: ChartOptions<"bar"> = {
    indexAxis: "y" as const,
    plugins: {
      legend: { display: false },
      title: { display: true, text: "Volume per Mixer" },
    },
    scales: {
      x: {
        title: { display: true, text: "Volume (L)" },
        beginAtZero: true,
      },
    },
  };

  const activeDispersers = disperserUtil.filter((d) => d.batchCount > 0);
  const disperserBarData: ChartData<"bar"> = {
    labels: activeDispersers.map((d) => d.name),
    datasets: [
      {
        label: "Batches",
        data: activeDispersers.map((d) => d.batchCount),
        backgroundColor: "#005CA9",
      },
      {
        label: "Total PMC",
        data: activeDispersers.map((d) => d.totalPMC),
        backgroundColor: "#F59E0B",
      },
    ],
  };

  const disperserBarOptions: ChartOptions<"bar"> = {
    plugins: {
      legend: { position: "top" as const },
      title: { display: true, text: "Disperser Usage: Batches & PMC Load" },
    },
    scales: { y: { beginAtZero: true } },
  };

  // ── Loading ─────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-10" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Filters bar */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 p-4">
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
            <select
              value={trunkFilter}
              onChange={(e) => setTrunkFilter(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              <option value="all">All Trunks</option>
              {allTrunks.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Base Type
            </p>
            <select
              value={baseFilter}
              onChange={(e) => setBaseFilter(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              <option value="all">All</option>
              <option value="SOLVENT">Solvent</option>
              <option value="WATER">Water</option>
            </select>
          </div>
          <div className="ml-auto text-xs text-muted-foreground">
            {filteredBatches.length} batches &bull; {allDates.length} days &bull;{" "}
            {weeklyData.length} weeks
          </div>
        </CardContent>
      </Card>

      {/* Chart view selector */}
      <div className="flex flex-wrap gap-2">
        {VIEW_BUTTONS.map((v) => (
          <Button
            key={v.id}
            variant={chartView === v.id ? "default" : "outline"}
            size="sm"
            onClick={() => setChartView(v.id)}
          >
            {v.label}
          </Button>
        ))}
      </div>

      {/* === MIXER UTILISATION === */}
      {chartView === "utilisation" && (
        <div className="space-y-6">
          <Card>
            <CardContent className="p-6">
              <BarChart
                data={mixerBarData}
                options={mixerBarOptions}
                height={460}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mixer Detail Table</CardTitle>
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
                        <TableCell className="text-center font-mono tabular-nums">
                          {m.batchCount}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
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
            <CardContent className="p-6">
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
                      <TableHead className="text-right">
                        Avg Batch (L)
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {weeklyData.map(([we, d]) => (
                      <TableRow key={we}>
                        <TableCell className="font-medium">
                          {format(new Date(we + "T12:00:00"), "d MMM yyyy")}
                        </TableCell>
                        <TableCell className="text-center font-mono tabular-nums">
                          {d.batches}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {d.volume.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
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
            <CardContent className="p-6">
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
            <CardContent className="p-6">
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
                        <TableCell className="text-center font-mono tabular-nums">
                          {d.batchCount}
                        </TableCell>
                        <TableCell className="text-center font-mono tabular-nums">
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
            <p className="text-xs text-muted-foreground">
              Litres produced per mixer per week. Darker = higher volume.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 min-w-[90px] bg-background px-2 py-1 text-left text-muted-foreground">
                      Mixer
                    </th>
                    {mixerHeatmap.weekLabels.map((wl, i) => (
                      <th
                        key={i}
                        className="px-1 py-1 text-center font-normal text-muted-foreground"
                        style={{
                          writingMode: "vertical-rl",
                          minWidth: "32px",
                          height: "60px",
                        }}
                      >
                        {wl}
                      </th>
                    ))}
                    <th className="sticky right-0 z-10 bg-background px-2 py-1 text-center text-muted-foreground">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {mixerHeatmap.rows.map((row, idx) => {
                    const rowTotal = row.cells.reduce((s, c) => s + c, 0);
                    if (
                      rowTotal === 0 &&
                      trunkFilter === "all" &&
                      baseFilter === "all"
                    )
                      return null;
                    return (
                      <tr key={idx}>
                        <td className="sticky left-0 z-10 border-r border-border bg-background px-2 py-1 font-medium">
                          <div className="flex items-center gap-1">
                            <span
                              className="inline-block h-2 w-2 rounded"
                              style={{
                                backgroundColor: trunkColor(row.trunk),
                              }}
                            />
                            {row.name}
                          </div>
                        </td>
                        {row.cells.map((val, ci) => (
                          <td
                            key={ci}
                            className="border border-border/30 text-center"
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
                          </td>
                        ))}
                        <td className="sticky right-0 z-10 border-l border-border bg-background px-2 py-1 text-center font-bold font-mono tabular-nums">
                          {rowTotal > 0
                            ? `${(rowTotal / 1000).toFixed(0)}k`
                            : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
            "h-full rounded-full",
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
