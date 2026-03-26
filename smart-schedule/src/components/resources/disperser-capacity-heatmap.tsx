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
  coreDates?: string[];
}

interface CellData {
  pmc: number;
  batch: number;
  cap: number;
  pct: number;
}

function getHeatClass(pct: number): string {
  if (pct === 0) return "";
  if (pct <= 50) return "bg-emerald-50 dark:bg-emerald-950/30";
  if (pct <= 80) return "bg-yellow-50 dark:bg-yellow-950/30";
  if (pct <= 100) return "bg-orange-50 dark:bg-orange-950/30";
  return "bg-red-100 dark:bg-red-950/40";
}

function getPctClass(pct: number): string {
  if (pct === 0) return "text-muted-foreground/50";
  if (pct <= 50) return "text-emerald-700 dark:text-emerald-400";
  if (pct <= 80) return "text-yellow-700 dark:text-yellow-400";
  if (pct <= 100) return "text-orange-700 dark:text-orange-400";
  return "text-red-700 dark:text-red-300 font-semibold";
}

function getPctBarColor(pct: number): string {
  if (pct === 0) return "bg-muted-foreground/20";
  if (pct <= 50) return "bg-emerald-500";
  if (pct <= 80) return "bg-yellow-500";
  if (pct <= 100) return "bg-orange-500";
  return "bg-red-500";
}

export function DisperserCapacityHeatmap({
  batches,
  resources,
  dates,
  bookendDates,
  coreDates,
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
        const dayBatches = batches.filter(
          (b) => b.planDisperserId === disperser.id && b.planDate === date,
        );

        const batchCount = dayBatches.length;
        const pmcTotal = dayBatches.reduce(
          (sum, b) => sum + Math.max(b.premixCount ?? 0, 1),
          0,
        );

        let cap: number;
        let pct: number;

        if (hasGroupCap) {
          cap = groupCap;
          const groupPmc =
            groupPmcByDate.get(disperser.groupName!)?.get(date) ?? 0;
          pct = cap > 0 ? Math.round((groupPmc / cap) * 100) : 0;
        } else {
          cap = disperser.maxBatchesPerDay;
          pct = cap > 0 ? Math.round((batchCount / cap) * 100) : 0;
        }

        dateMap.set(date, { pmc: pmcTotal, batch: batchCount, cap, pct });
      }

      data.set(disperser.id, dateMap);
    }

    return data;
  }, [dispersers, dates, batches, groupPmcByDate]);

  const firstCoreDate = coreDates?.[0] ?? dates[0] ?? "";
  const colCount = dates.length;

  if (dispersers.length === 0) return null;

  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-4 py-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Disperser Capacity Heat Map
        </h3>
      </div>

      <div className="overflow-x-auto">
        <div
          className="grid min-w-[800px]"
          style={{
            gridTemplateColumns: `180px repeat(${colCount}, minmax(120px, 1fr))`,
          }}
        >
          {/* Header row */}
          <div className="border-b border-r bg-muted px-3 py-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase">
              Disperser
            </span>
          </div>
          {dates.map((dateStr) => {
            const date = new Date(dateStr + "T12:00:00");
            const isBookend = bookendDates.has(dateStr);
            return (
              <div
                key={dateStr}
                className={cn(
                  "border-b border-r px-2 py-2 text-center",
                  isBookend && "bg-muted/60 opacity-70",
                )}
              >
                <div className={cn("text-xs font-semibold", isBookend && "text-muted-foreground")}>
                  {format(date, "EEE")}
                  {isBookend && (
                    <span className="ml-1 text-[9px] font-normal text-muted-foreground/70">
                      {dateStr < firstCoreDate ? "(prev)" : "(next)"}
                    </span>
                  )}
                </div>
                <div className={cn("text-sm tabular-nums", isBookend && "text-muted-foreground")}>
                  {format(date, "d MMM")}
                </div>
              </div>
            );
          })}

          {/* Disperser rows */}
          {dispersers.map((disperser) => {
            const dateMap = heatData.get(disperser.id);
            return (
              <RowContents
                key={disperser.id}
                label={disperser.displayName ?? disperser.resourceCode}
                dates={dates}
                dateMap={dateMap}
                bookendDates={bookendDates}
              />
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 border-t px-4 py-2 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-5 rounded-sm bg-emerald-500" />
          <span>0–50%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-5 rounded-sm bg-yellow-500" />
          <span>51–80%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-5 rounded-sm bg-orange-500" />
          <span>81–100%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-5 rounded-sm bg-red-500" />
          <span>Over 100%</span>
        </div>
      </div>
    </div>
  );
}

function RowContents({
  label,
  dates,
  dateMap,
  bookendDates,
}: {
  label: string;
  dates: string[];
  dateMap: Map<string, CellData> | undefined;
  bookendDates: Set<string>;
}) {
  return (
    <>
      <div className="border-b border-r bg-card px-3 py-2 text-xs font-medium whitespace-nowrap flex items-center">
        {label}
      </div>
      {dates.map((dateStr) => {
        const cell = dateMap?.get(dateStr);
        const isBookend = bookendDates.has(dateStr);
        if (!cell || (cell.pmc === 0 && cell.batch === 0)) {
          return (
            <div
              key={dateStr}
              className={cn(
                "border-b border-r px-2 py-2 text-center",
                isBookend && "bg-muted/30",
              )}
            >
              <div className="text-[10px] text-muted-foreground/40 tabular-nums">
                0 / {cell?.cap ?? "—"}
              </div>
            </div>
          );
        }
        return (
          <div
            key={dateStr}
            className={cn(
              "border-b border-r px-2 py-1.5",
              getHeatClass(cell.pct),
              isBookend && "opacity-70",
            )}
          >
            {/* PMC / Cap */}
            <div className="flex items-baseline justify-center gap-0.5 tabular-nums">
              <span className={cn("text-xs font-semibold", getPctClass(cell.pct))}>
                {cell.pmc}
              </span>
              <span className="text-[10px] text-muted-foreground">/</span>
              <span className="text-[10px] text-muted-foreground">{cell.cap}</span>
            </div>
            {/* Utilisation bar */}
            <div className="mt-1 h-1 w-full rounded-full bg-muted-foreground/15 overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all", getPctBarColor(cell.pct))}
                style={{ width: `${Math.min(cell.pct, 100)}%` }}
              />
            </div>
            {/* Percentage */}
            <div className={cn("mt-0.5 text-center text-[9px] tabular-nums", getPctClass(cell.pct))}>
              {cell.pct}%
              {cell.batch > 0 && (
                <span className="ml-1 text-muted-foreground">
                  ({cell.batch}b)
                </span>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
