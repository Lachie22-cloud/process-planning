import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, addDays, isWeekend } from "date-fns";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "@/hooks/use-current-site";
import { useResources } from "@/hooks/use-resources";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import type { Batch } from "@/types/batch";
import type { LinkedFillOrder } from "@/types/batch";
import type { Resource } from "@/types/resource";

interface WeeklyFillingBreakdownProps {
  batches: Batch[];
  weekStart: Date;
  weekEnding: Date;
}

/** Parse a pack size string like "500ml", "1L", "2.5L", "10L" into litres */
function parsePackSizeLitres(packSize: string | null): number | null {
  if (!packSize) return null;
  const s = packSize.trim().toLowerCase();
  // Match patterns like "500ml", "0.5l", "1l", "2.5l", "10l", "20l"
  const mlMatch = s.match(/^([\d.]+)\s*ml$/);
  if (mlMatch) return parseFloat(mlMatch[1]) / 1000;
  const lMatch = s.match(/^([\d.]+)\s*l$/);
  if (lMatch) return parseFloat(lMatch[1]);
  return null;
}

/** Get weekday dates (Mon–Fri) between weekStart and weekEnding */
function getWeekdays(weekStart: Date, weekEnding: Date): Date[] {
  const days: Date[] = [];
  let d = new Date(weekStart);
  while (d <= weekEnding) {
    if (!isWeekend(d)) {
      days.push(new Date(d));
    }
    d = addDays(d, 1);
  }
  return days;
}

const BLUE_LID_COMPONENT = "LOPBOCAPF";
const RED_LID_COMPONENT = "ANOPR15X";

export function WeeklyFillingBreakdown({
  batches,
  weekStart,
  weekEnding,
}: WeeklyFillingBreakdownProps) {
  const { site } = useCurrentSite();
  const { data: resources = [] } = useResources();

  const batchIds = useMemo(() => batches.map((b) => b.id), [batches]);

  // Fetch all linked fill orders for this week's batches
  const { data: fillOrders = [], isLoading: fillOrdersLoading } = useQuery<
    LinkedFillOrder[]
  >({
    queryKey: ["fill_orders_week", site?.id, batchIds],
    queryFn: async () => {
      if (!site || batchIds.length === 0) return [];

      // Supabase .in() has a limit, so chunk if needed
      const chunkSize = 200;
      const results: LinkedFillOrder[] = [];
      for (let i = 0; i < batchIds.length; i += chunkSize) {
        const chunk = batchIds.slice(i, i + chunkSize);
        const { data, error } = await supabase
          .from("linked_fill_orders")
          .select("*")
          .eq("site_id", site.id)
          .in("batch_id", chunk);
        if (error) throw error;
        if (data) {
          results.push(
            ...data.map((r: Record<string, unknown>) => ({
              id: r.id as string,
              batchId: r.batch_id as string,
              siteId: r.site_id as string,
              fillOrder: r.fill_order as string | null,
              fillMaterial: r.fill_material as string | null,
              fillDescription: r.fill_description as string | null,
              packSize: r.pack_size as string | null,
              quantity: r.quantity as number | null,
              unit: r.unit as string | null,
              lidType: r.lid_type as string | null,
            })),
          );
        }
      }
      return results;
    },
    enabled: !!site && batchIds.length > 0,
  });

  const weekdays = useMemo(
    () => getWeekdays(weekStart, weekEnding),
    [weekStart, weekEnding],
  );

  // Build lookup: batchId → batch
  const batchMap = useMemo(() => {
    const m = new Map<string, Batch>();
    for (const b of batches) m.set(b.id, b);
    return m;
  }, [batches]);

  // Build lookup: batchId → fill orders
  const fillOrdersByBatch = useMemo(() => {
    const m = new Map<string, LinkedFillOrder[]>();
    for (const fo of fillOrders) {
      const existing = m.get(fo.batchId) ?? [];
      existing.push(fo);
      m.set(fo.batchId, existing);
    }
    return m;
  }, [fillOrders]);

  // Build resource lookup: resourceId → resource
  const resourceMap = useMemo(() => {
    const m = new Map<string, Resource>();
    for (const r of resources) m.set(r.id, r);
    return m;
  }, [resources]);

  // Compute daily metrics
  const dailyMetrics = useMemo(() => {
    return weekdays.map((day) => {
      const dateStr = format(day, "yyyy-MM-dd");
      const dayBatches = batches.filter((b) => b.planDate === dateStr);
      const dayFillOrders = dayBatches.flatMap(
        (b) => fillOrdersByBatch.get(b.id) ?? [],
      );

      const batchCount = dayBatches.length;
      const volume = dayBatches.reduce(
        (sum, b) => sum + (b.batchVolume ?? 0),
        0,
      );
      const items = dayFillOrders.reduce(
        (sum, fo) => sum + (fo.quantity ?? 0),
        0,
      );

      // Small items: fill orders where pack size ≤ 3L
      const smallItems = dayFillOrders
        .filter((fo) => {
          const litres = parsePackSizeLitres(fo.packSize);
          return litres !== null && litres <= 3;
        })
        .reduce((sum, fo) => sum + (fo.quantity ?? 0), 0);

      // Blue lids: fill orders where fill_material contains LOPBOCAPF
      const blueLids = dayFillOrders
        .filter((fo) =>
          fo.fillMaterial?.toUpperCase().includes(BLUE_LID_COMPONENT),
        )
        .reduce((sum, fo) => sum + (fo.quantity ?? 0), 0);

      // Red lids: fill orders where fill_material contains ANOPR15X
      const redLids = dayFillOrders
        .filter((fo) =>
          fo.fillMaterial?.toUpperCase().includes(RED_LID_COMPONENT),
        )
        .reduce((sum, fo) => sum + (fo.quantity ?? 0), 0);

      // 500ml items
      const items500ml = dayFillOrders
        .filter((fo) => {
          const litres = parsePackSizeLitres(fo.packSize);
          return litres !== null && litres === 0.5;
        })
        .reduce((sum, fo) => sum + (fo.quantity ?? 0), 0);

      // Manual fills: count fill order lines from batches > 40L
      const manualFillBatchIds = new Set(
        dayBatches
          .filter((b) => (b.batchVolume ?? 0) > 40)
          .map((b) => b.id),
      );
      const manualFills = dayFillOrders.filter((fo) =>
        manualFillBatchIds.has(fo.batchId),
      ).length;

      return {
        date: day,
        dateStr,
        dayLabel: format(day, "EEE"),
        dateLabel: format(day, "d MMM"),
        batchCount,
        volume,
        items,
        smallItems,
        redLids,
        blueLids,
        items500ml,
        manualFills,
      };
    });
  }, [weekdays, batches, fillOrdersByBatch]);

  // Compute totals
  const totals = useMemo(() => {
    return dailyMetrics.reduce(
      (acc, day) => ({
        batchCount: acc.batchCount + day.batchCount,
        volume: acc.volume + day.volume,
        items: acc.items + day.items,
        smallItems: acc.smallItems + day.smallItems,
        redLids: acc.redLids + day.redLids,
        blueLids: acc.blueLids + day.blueLids,
        items500ml: acc.items500ml + day.items500ml,
        manualFills: acc.manualFills + day.manualFills,
      }),
      {
        batchCount: 0,
        volume: 0,
        items: 0,
        smallItems: 0,
        redLids: 0,
        blueLids: 0,
        items500ml: 0,
        manualFills: 0,
      },
    );
  }, [dailyMetrics]);

  // Trunk breakdown: items per trunk per day
  const trunkData = useMemo(() => {
    // Collect all trunk lines from resources that have batches
    const trunkSet = new Set<string>();
    for (const b of batches) {
      if (b.planResourceId) {
        const res = resourceMap.get(b.planResourceId);
        if (res?.trunkLine) trunkSet.add(res.trunkLine);
      }
    }
    const trunkLines = Array.from(trunkSet).sort();

    return trunkLines.map((trunk) => {
      const daily = weekdays.map((day) => {
        const dateStr = format(day, "yyyy-MM-dd");
        const dayBatches = batches.filter((b) => {
          if (b.planDate !== dateStr) return false;
          const res = b.planResourceId
            ? resourceMap.get(b.planResourceId)
            : null;
          return res?.trunkLine === trunk;
        });
        const dayFillOrders = dayBatches.flatMap(
          (b) => fillOrdersByBatch.get(b.id) ?? [],
        );
        return dayFillOrders.reduce(
          (sum, fo) => sum + (fo.quantity ?? 0),
          0,
        );
      });
      const total = daily.reduce((s, v) => s + v, 0);
      return { trunk, daily, total };
    });
  }, [batches, weekdays, resourceMap, fillOrdersByBatch]);

  if (fillOrdersLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  const metricRows: {
    label: string;
    dot?: string;
    getValue: (
      day: (typeof dailyMetrics)[0],
    ) => number;
    getTotal: () => number;
    bold?: boolean;
  }[] = [
    {
      label: "Batches",
      getValue: (d) => d.batchCount,
      getTotal: () => totals.batchCount,
      bold: true,
    },
    {
      label: "Volume (L)",
      getValue: (d) => d.volume,
      getTotal: () => totals.volume,
    },
    {
      label: "Items",
      getValue: (d) => d.items,
      getTotal: () => totals.items,
      bold: true,
    },
    {
      label: "Small Items (≤3L)",
      dot: "bg-amber-400",
      getValue: (d) => d.smallItems,
      getTotal: () => totals.smallItems,
    },
    {
      label: "Red Lids",
      dot: "bg-red-500",
      getValue: (d) => d.redLids,
      getTotal: () => totals.redLids,
    },
    {
      label: "Blue Lids",
      dot: "bg-blue-500",
      getValue: (d) => d.blueLids,
      getTotal: () => totals.blueLids,
    },
    {
      label: "500ml Items",
      dot: "bg-purple-400",
      getValue: (d) => d.items500ml,
      getTotal: () => totals.items500ml,
    },
    {
      label: "Manual Fills (>40L)",
      dot: "bg-orange-400",
      getValue: (d) => d.manualFills,
      getTotal: () => totals.manualFills,
    },
  ];

  return (
    <div className="space-y-8">
      {/* Daily Filling Line Breakdown */}
      <div>
        <h3 className="mb-3 text-base font-semibold">
          Daily Filling Line Breakdown
        </h3>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-900 hover:bg-slate-900">
                <TableHead className="text-white font-semibold min-w-[200px]">
                  Metric
                </TableHead>
                {dailyMetrics.map((day) => (
                  <TableHead
                    key={day.dateStr}
                    className="text-center text-white font-semibold"
                  >
                    <div>{day.dayLabel}</div>
                    <div className="text-xs font-normal opacity-75">
                      {day.dateLabel}
                    </div>
                  </TableHead>
                ))}
                <TableHead className="text-center text-white font-semibold bg-indigo-900/50">
                  Total
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {metricRows.map((row, idx) => (
                <TableRow
                  key={row.label}
                  className={idx % 2 === 0 ? "bg-background" : "bg-muted/30"}
                >
                  <TableCell
                    className={`whitespace-nowrap ${row.bold ? "font-semibold" : ""}`}
                  >
                    <span className="flex items-center gap-2">
                      {row.dot && (
                        <span
                          className={`inline-block h-2.5 w-2.5 rounded-full ${row.dot}`}
                        />
                      )}
                      {row.label}
                    </span>
                  </TableCell>
                  {dailyMetrics.map((day) => (
                    <TableCell
                      key={day.dateStr}
                      className={`text-center tabular-nums ${row.bold ? "font-semibold" : ""}`}
                    >
                      {row.getValue(day).toLocaleString()}
                    </TableCell>
                  ))}
                  <TableCell
                    className={`text-center tabular-nums font-bold ${
                      row.bold ? "text-indigo-600 dark:text-indigo-400" : ""
                    } bg-indigo-50/50 dark:bg-indigo-950/20`}
                  >
                    {row.getTotal().toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Finished Good Items Per Trunk */}
      {trunkData.length > 0 && (
        <div>
          <h3 className="mb-3 text-base font-semibold uppercase tracking-wide">
            Finished Good Items Per Trunk
          </h3>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-semibold min-w-[200px]">
                    Trunk
                  </TableHead>
                  {dailyMetrics.map((day) => (
                    <TableHead
                      key={day.dateStr}
                      className="text-center font-semibold"
                    >
                      {day.dayLabel}
                    </TableHead>
                  ))}
                  <TableHead className="text-center font-semibold">
                    Total
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trunkData.map((row, idx) => {
                  // Assign soft background colours to trunk badges
                  const trunkColours: Record<string, string> = {
                    THINNERS: "bg-slate-800 text-white",
                    TK1: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
                    TK2: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200",
                    TK3: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
                    TK4: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
                    TK5: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
                    TK6: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
                  };
                  const badgeClass =
                    trunkColours[row.trunk] ??
                    "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";

                  return (
                    <TableRow
                      key={row.trunk}
                      className={
                        idx % 2 === 0 ? "bg-background" : "bg-muted/30"
                      }
                    >
                      <TableCell>
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${badgeClass}`}
                        >
                          {row.trunk}
                        </span>
                      </TableCell>
                      {row.daily.map((val, i) => (
                        <TableCell
                          key={dailyMetrics[i].dateStr}
                          className="text-center tabular-nums"
                        >
                          {val.toLocaleString()}
                        </TableCell>
                      ))}
                      <TableCell className="text-center tabular-nums font-bold text-indigo-600 dark:text-indigo-400">
                        {row.total.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
