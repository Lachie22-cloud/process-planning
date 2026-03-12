import { useMemo } from "react";
import { format } from "date-fns";
import { PageHeader } from "@/components/layout/page-header";
import { WeekSelector } from "@/components/schedule/week-selector";
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
import { StatusBadge } from "@/components/schedule/status-badge";
import { ColorGroupBadge } from "@/components/shared/color-group-badge";
import {
  Layers,
  Droplets,
  BarChart3,
  TrendingUp,
  Package,
  AlertTriangle,
} from "lucide-react";
import { useWeek } from "@/hooks/use-week";
import { useBatches } from "@/hooks/use-batches";
import { BATCH_STATUSES, BATCH_STATUS_LIST } from "@/lib/constants/statuses";
import { COLOR_GROUPS } from "@/lib/constants/color-groups";
import { ScanTrigger } from "@/components/ai/scan-trigger";
import type { Batch, BatchStatus } from "@/types/batch";

function KpiCard({
  label,
  value,
  icon: Icon,
  colour,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  colour?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-6">
        <Icon className={`h-8 w-8 shrink-0 opacity-80 ${colour ?? "text-foreground"}`} />
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-3xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function StatisticsPage() {
  const week = useWeek();

  const weekStartStr = useMemo(
    () => format(week.weekStart, "yyyy-MM-dd"),
    [week.weekStart],
  );

  const { data: batches = [], isLoading } = useBatches({
    weekStart: weekStartStr,
    weekEnding: week.weekEndingStr,
  });

  const totalVolume = useMemo(
    () => batches.reduce((sum, b) => sum + (b.batchVolume ?? 0), 0),
    [batches],
  );
  const avgBatchSize = batches.length > 0 ? Math.round(totalVolume / batches.length) : 0;

  // Status distribution
  const statusCounts = useMemo(() => {
    const counts = new Map<BatchStatus, number>();
    for (const b of batches) {
      counts.set(b.status, (counts.get(b.status) ?? 0) + 1);
    }
    return BATCH_STATUS_LIST.map((status) => ({
      status,
      count: counts.get(status) ?? 0,
    })).filter((s) => s.count > 0);
  }, [batches]);

  // Material availability
  const materialIssues = useMemo(() => {
    const wom = batches.filter((b) => !b.rmAvailable).length;
    const wop = batches.filter((b) => !b.packagingAvailable).length;
    const ready = batches.filter((b) => b.rmAvailable && b.packagingAvailable).length;
    return { wom, wop, ready };
  }, [batches]);

  // Colour group distribution
  const colourCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of batches) {
      if (b.sapColorGroup) {
        counts.set(b.sapColorGroup, (counts.get(b.sapColorGroup) ?? 0) + 1);
      }
    }
    return Object.entries(COLOR_GROUPS)
      .map(([code, config]) => ({
        code,
        name: config.name,
        color: config.color,
        count: counts.get(code) ?? 0,
      }))
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [batches]);

  // Daily breakdown
  const dailyBreakdown = useMemo(() => {
    const dateMap = new Map<string, Batch[]>();
    for (const b of batches) {
      if (b.planDate) {
        const existing = dateMap.get(b.planDate) ?? [];
        existing.push(b);
        dateMap.set(b.planDate, existing);
      }
    }
    return Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, dayBatches]) => ({
        date,
        dayLabel: format(new Date(date + "T12:00:00"), "EEE d MMM"),
        count: dayBatches.length,
        volume: dayBatches.reduce((s, b) => s + (b.batchVolume ?? 0), 0),
        materialIssues: dayBatches.filter((b) => !b.rmAvailable || !b.packagingAvailable).length,
      }));
  }, [batches]);

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title="Statistics" actions={<WeekSelector week={week} />} />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Statistics"
        description="Key performance indicators and analytics"
        actions={<WeekSelector week={week} />}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard icon={Layers} label="Total Batches" value={batches.length.toLocaleString()} />
        <KpiCard icon={Droplets} label="Total Volume" value={`${totalVolume.toLocaleString()}L`} />
        <KpiCard icon={TrendingUp} label="Avg Batch Size" value={`${avgBatchSize.toLocaleString()}L`} />
        <KpiCard
          icon={BarChart3}
          label="Completion Rate"
          value={
            batches.length > 0
              ? `${Math.round((batches.filter((b) => b.status === "Complete").length / batches.length) * 100)}%`
              : "—"
          }
          colour="text-emerald-600"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {statusCounts.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No batches this week.
              </p>
            ) : (
              <div className="space-y-2">
                {statusCounts.map(({ status, count }) => {
                  const pct = Math.round((count / batches.length) * 100);
                  const config = BATCH_STATUSES[status];
                  return (
                    <div key={status} className="flex items-center gap-3">
                      <StatusBadge status={status} className="w-28 justify-center" />
                      <div className="flex-1">
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: config?.color,
                            }}
                          />
                        </div>
                      </div>
                      <span className="w-16 text-right text-sm tabular-nums">
                        {count} ({pct}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Material Availability */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Material Availability</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950">
                  <Package className="h-5 w-5 text-emerald-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">All Materials Ready</p>
                  <p className="text-xs text-muted-foreground">RM + Packaging available</p>
                </div>
                <span className="text-lg font-bold text-emerald-600">
                  {materialIssues.ready}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-950">
                  <AlertTriangle className="h-5 w-5 text-orange-500" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Waiting on Materials</p>
                  <p className="text-xs text-muted-foreground">Raw materials not available</p>
                </div>
                <span className="text-lg font-bold text-orange-500">
                  {materialIssues.wom}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950">
                  <Package className="h-5 w-5 text-amber-500" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Waiting on Packaging</p>
                  <p className="text-xs text-muted-foreground">Packaging not available</p>
                </div>
                <span className="text-lg font-bold text-amber-500">
                  {materialIssues.wop}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Colour Group Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Colour Group Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {colourCounts.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No colour data available.
              </p>
            ) : (
              <div className="space-y-2">
                {colourCounts.map(({ code, count, color }) => {
                  const pct = Math.round((count / batches.length) * 100);
                  return (
                    <div key={code} className="flex items-center gap-3">
                      <div className="w-24">
                        <ColorGroupBadge code={code} />
                      </div>
                      <div className="flex-1">
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${pct}%`, backgroundColor: color }}
                          />
                        </div>
                      </div>
                      <span className="w-16 text-right text-sm tabular-nums">
                        {count} ({pct}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI Analysis Scan Trigger */}
        <ScanTrigger />

        {/* Daily Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daily Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead className="text-right">Batches</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                  <TableHead className="text-right">Issues</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dailyBreakdown.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No data for this week.
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {dailyBreakdown.map((day) => (
                      <TableRow key={day.date}>
                        <TableCell className="font-medium">{day.dayLabel}</TableCell>
                        <TableCell className="text-right tabular-nums">{day.count}</TableCell>
                        <TableCell className="text-right tabular-nums font-mono">
                          {day.volume.toLocaleString()}L
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {day.materialIssues > 0 ? (
                            <span className="text-amber-600">{day.materialIssues}</span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-semibold bg-muted/50">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right tabular-nums">{batches.length}</TableCell>
                      <TableCell className="text-right tabular-nums font-mono">
                        {totalVolume.toLocaleString()}L
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {materialIssues.wom + materialIssues.wop}
                      </TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
