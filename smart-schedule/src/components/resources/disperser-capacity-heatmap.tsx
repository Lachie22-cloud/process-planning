import { useMemo } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/ui/cn";
import type { Batch } from "@/types/batch";
import type { Resource } from "@/types/resource";

interface DisperserCapacityHeatmapProps {
  batches: Batch[];
  resources: Resource[];
  dates: string[];
  bookendDates: Set<string>;
}

interface CellData {
  pmc: number;
  batch: number;
  cap: number;
  pct: number;
}

function getHeatClass(pct: number): string {
  if (pct === 0) return "";
  if (pct <= 50) return "";
  if (pct <= 80) return "bg-amber-50 dark:bg-amber-950/30";
  if (pct <= 100) return "bg-amber-200 dark:bg-amber-900/50";
  return "bg-red-200 dark:bg-red-900/50";
}

function getPctClass(pct: number): string {
  if (pct === 0) return "text-muted-foreground";
  if (pct <= 50) return "";
  if (pct <= 80) return "text-amber-700 dark:text-amber-400 font-medium";
  if (pct <= 100) return "text-amber-800 dark:text-amber-300 font-semibold";
  return "text-red-700 dark:text-red-300 font-semibold";
}

export function DisperserCapacityHeatmap({
  batches,
  resources,
  dates,
  bookendDates,
}: DisperserCapacityHeatmapProps) {
  const dispersers = useMemo(
    () =>
      resources
        .filter((r) => r.resourceType === "disperser" && r.active)
        .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999)),
    [resources],
  );

  // Build group lookup: groupName -> Set of disperser IDs in that group
  const groupMembers = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const d of dispersers) {
      if (d.groupName) {
        let set = map.get(d.groupName);
        if (!set) {
          set = new Set();
          map.set(d.groupName, set);
        }
        set.add(d.id);
      }
    }
    return map;
  }, [dispersers]);

  // Pre-compute group-level PMC totals per date for groups with groupCapacity
  // groupName -> date -> total PMC across all group members
  const groupPmcByDate = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const [groupName, memberIds] of groupMembers) {
      const dateMap = new Map<string, number>();
      for (const date of dates) {
        const total = batches
          .filter(
            (b) =>
              b.planDisperserId != null &&
              memberIds.has(b.planDisperserId) &&
              b.planDate === date,
          )
          .reduce((sum, b) => sum + Math.max(b.premixCount ?? 0, 1), 0);
        dateMap.set(date, total);
      }
      map.set(groupName, dateMap);
    }
    return map;
  }, [groupMembers, dates, batches]);

  // Build heatmap data: disperserId -> date -> CellData
  const heatData = useMemo(() => {
    const data = new Map<string, Map<string, CellData>>();

    for (const disperser of dispersers) {
      const dateMap = new Map<string, CellData>();
      const hasGroupCap =
        disperser.groupName != null && disperser.groupCapacity != null;
      const groupCap = disperser.groupCapacity ?? 0;

      for (const date of dates) {
        // Batches assigned to this individual disperser on this date
        const dayBatches = batches.filter(
          (b) => b.planDisperserId === disperser.id && b.planDate === date,
        );

        const batchCount = dayBatches.length;
        const pmcTotal = dayBatches.reduce(
          (sum, b) => sum + Math.max(b.premixCount ?? 0, 1),
          0,
        );

        // Capacity & utilisation based on group or individual
        let cap: number;
        let pct: number;

        if (hasGroupCap) {
          // Group-based: CAP = group capacity, % = group PMC total / group capacity
          cap = groupCap;
          const groupPmc =
            groupPmcByDate.get(disperser.groupName!)?.get(date) ?? 0;
          pct = cap > 0 ? Math.round((groupPmc / cap) * 100) : 0;
        } else {
          // Individual fallback: CAP = maxBatchesPerDay, % = batch count / cap
          cap = disperser.maxBatchesPerDay;
          pct = cap > 0 ? Math.round((batchCount / cap) * 100) : 0;
        }

        dateMap.set(date, { pmc: pmcTotal, batch: batchCount, cap, pct });
      }

      data.set(disperser.id, dateMap);
    }

    return data;
  }, [dispersers, dates, batches, groupPmcByDate]);

  if (dispersers.length === 0) return null;

  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-4 py-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">
          Disperser Capacity Heat Map (PMC-Based)
        </h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            {/* Day header row */}
            <tr className="bg-muted/50">
              <th
                rowSpan={2}
                className="sticky left-0 z-10 min-w-[120px] border-r bg-muted px-3 py-2 text-left text-xs font-semibold uppercase text-muted-foreground"
              />
              {dates.map((dateStr) => {
                const date = new Date(dateStr + "T12:00:00");
                const isBookend = bookendDates.has(dateStr);
                const dayLabel = format(date, "EEEE");
                const suffix = isBookend
                  ? format(date, "EEE") === "Fri"
                    ? " (prev)"
                    : " (next)"
                  : "";

                return (
                  <th
                    key={dateStr}
                    colSpan={4}
                    className={cn(
                      "border-x border-b px-1 py-2 text-center text-xs font-semibold",
                      isBookend ? "text-primary/70" : "text-foreground",
                    )}
                  >
                    {dayLabel}
                    {suffix && (
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                        {suffix}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
            {/* Sub-column header row */}
            <tr className="bg-muted/30">
              {dates.map((dateStr) => (
                <SubColumnHeaders key={dateStr} />
              ))}
            </tr>
          </thead>
          <tbody>
            {dispersers.map((disperser) => {
              const dateMap = heatData.get(disperser.id);
              return (
                <tr
                  key={disperser.id}
                  className="border-t hover:bg-muted/20 transition-colors"
                >
                  <td className="sticky left-0 z-10 border-r bg-card px-3 py-1.5 font-medium whitespace-nowrap">
                    {disperser.displayName ?? disperser.resourceCode}
                  </td>
                  {dates.map((dateStr) => {
                    const cell = dateMap?.get(dateStr);
                    if (!cell) {
                      return <EmptyCells key={dateStr} />;
                    }
                    return <DayCells key={dateStr} cell={cell} />;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 border-t px-4 py-2 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-5 rounded border bg-amber-50 dark:bg-amber-950/30" />
          <span>51-80%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-5 rounded border bg-amber-200 dark:bg-amber-900/50" />
          <span>81-100%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-5 rounded border bg-red-200 dark:bg-red-900/50" />
          <span>Over 100%</span>
        </div>
      </div>
    </div>
  );
}

function SubColumnHeaders() {
  return (
    <>
      <th className="border-x px-1.5 py-1 text-center text-[10px] font-medium uppercase text-muted-foreground w-10">
        PMC
      </th>
      <th className="border-r px-1.5 py-1 text-center text-[10px] font-medium uppercase text-muted-foreground w-10">
        Batch
      </th>
      <th className="border-r px-1.5 py-1 text-center text-[10px] font-medium uppercase text-muted-foreground w-10">
        Cap
      </th>
      <th className="border-r px-1.5 py-1 text-center text-[10px] font-medium uppercase text-muted-foreground w-10">
        %
      </th>
    </>
  );
}

function EmptyCells() {
  return (
    <>
      <td className="border-x px-1.5 py-1.5 text-center tabular-nums text-muted-foreground" />
      <td className="border-r px-1.5 py-1.5 text-center tabular-nums text-muted-foreground" />
      <td className="border-r px-1.5 py-1.5 text-center tabular-nums text-muted-foreground" />
      <td className="border-r px-1.5 py-1.5 text-center tabular-nums text-muted-foreground" />
    </>
  );
}

function DayCells({ cell }: { cell: CellData }) {
  const heatBg = getHeatClass(cell.pct);
  const pctColor = getPctClass(cell.pct);

  return (
    <>
      <td
        className={cn(
          "border-x px-1.5 py-1.5 text-center tabular-nums",
          heatBg,
        )}
      >
        {cell.pmc > 0 ? cell.pmc : ""}
      </td>
      <td
        className={cn(
          "border-r px-1.5 py-1.5 text-center tabular-nums",
          heatBg,
        )}
      >
        {cell.batch > 0 ? cell.batch : ""}
      </td>
      <td
        className={cn(
          "border-r px-1.5 py-1.5 text-center tabular-nums",
          heatBg,
        )}
      >
        {cell.cap}
      </td>
      <td
        className={cn(
          "border-r px-1.5 py-1.5 text-center tabular-nums",
          pctColor,
          heatBg,
        )}
      >
        {cell.pct > 0 ? `${cell.pct}%` : ""}
      </td>
    </>
  );
}
