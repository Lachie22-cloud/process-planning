import { useMemo, useState } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/ui/cn";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Batch } from "@/types/batch";
import type { Resource } from "@/types/resource";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

interface HeatTier {
  textCls: string;
  borderCls: string;
  barCls: string;
  sqUsed: string;
  sq: string;
  stroke: string;
  fill: string;
}

// ---------------------------------------------------------------------------
// Heat tier helpers
// ---------------------------------------------------------------------------

function getTier(pct: number): HeatTier {
  if (pct <= 0)
    return {
      textCls: "text-muted-foreground",
      borderCls: "border-border",
      barCls: "bg-muted-foreground/40",
      sqUsed: "bg-muted-foreground",
      sq: "bg-muted",
      stroke: "currentColor",
      fill: "transparent",
    };
  if (pct <= 50)
    return {
      textCls: "text-green-600 dark:text-green-400",
      borderCls: "border-green-300 dark:border-green-800/50",
      barCls: "bg-green-500",
      sqUsed: "bg-green-500",
      sq: "bg-muted",
      stroke: "#22c55e",
      fill: "rgba(34,197,94,0.15)",
    };
  if (pct <= 80)
    return {
      textCls: "text-yellow-600 dark:text-yellow-400",
      borderCls: "border-yellow-300 dark:border-yellow-700/50",
      barCls: "bg-yellow-500",
      sqUsed: "bg-yellow-500",
      sq: "bg-muted",
      stroke: "#eab308",
      fill: "rgba(234,179,8,0.15)",
    };
  if (pct <= 100)
    return {
      textCls: "text-orange-600 dark:text-orange-400",
      borderCls: "border-orange-300 dark:border-orange-700/50",
      barCls: "bg-orange-500",
      sqUsed: "bg-orange-500",
      sq: "bg-muted",
      stroke: "#f97316",
      fill: "rgba(249,115,22,0.15)",
    };
  return {
    textCls: "text-red-600 dark:text-red-400",
    borderCls: "border-red-300 dark:border-red-700/50",
    barCls: "bg-red-500",
    sqUsed: "bg-red-500",
    sq: "bg-muted",
    stroke: "#ef4444",
    fill: "rgba(239,68,68,0.2)",
  };
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function RingGauge({ pct, size }: { pct: number; size: number }) {
  const r = size * 0.38;
  const circ = 2 * Math.PI * r;
  const off = circ - (circ * Math.min(pct, 100)) / 100;
  const t = getTier(pct);
  return (
    <svg width={size} height={size}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        className="stroke-muted"
        strokeWidth={size * 0.08}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={t.stroke}
        strokeWidth={size * 0.08}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={off}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="transition-all duration-500"
      />
    </svg>
  );
}

function WaffleSquares({
  used,
  cap,
  tier: t,
  size = 20,
}: {
  used: number;
  cap: number;
  tier: HeatTier;
  size?: number;
}) {
  return (
    <div className="flex gap-1 flex-wrap">
      {Array.from({ length: cap }, (_, i) => (
        <div
          key={i}
          className={cn("rounded", i < used ? t.sqUsed : t.sq, i >= used && "opacity-35")}
          style={{ width: size, height: size }}
        />
      ))}
    </div>
  );
}

function HeatLegend() {
  return (
    <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <div className="h-3 w-5 rounded border bg-green-100 dark:bg-green-900/40" />
        <span>0–50%</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="h-3 w-5 rounded border bg-yellow-100 dark:bg-yellow-900/40" />
        <span>51–80%</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="h-3 w-5 rounded border bg-orange-100 dark:bg-orange-900/40" />
        <span>81–100%</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="h-3 w-5 rounded border bg-red-200 dark:bg-red-900/50" />
        <span>Over 100%</span>
      </div>
    </div>
  );
}

function DayPills({
  dates,
  bookendDates,
  firstCoreDate,
  selectedDate,
  onSelect,
  getMaxPct,
}: {
  dates: string[];
  bookendDates: Set<string>;
  firstCoreDate: string;
  selectedDate: string;
  onSelect: (idx: number) => void;
  getMaxPct: (date: string) => number;
}) {
  const todayStr = format(new Date(), "yyyy-MM-dd");
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1 px-4">
      {dates.map((dateStr, idx) => {
        const date = new Date(dateStr + "T12:00:00");
        const isBookend = bookendDates.has(dateStr);
        const isActive = dateStr === selectedDate;
        const isToday = dateStr === todayStr;
        const maxP = getMaxPct(dateStr);
        const t = getTier(maxP);
        const suffix = isBookend
          ? dateStr < firstCoreDate ? "prev" : "next"
          : null;
        return (
          <button
            key={dateStr}
            onClick={() => onSelect(idx)}
            className={cn(
              "relative flex flex-shrink-0 flex-col items-center rounded-xl border px-4 py-2 min-w-[64px] transition-all",
              isActive
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:bg-muted",
            )}
          >
            <span
              className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full"
              style={{ background: maxP > 0 ? t.stroke : "transparent" }}
            />
            <span className="text-xs font-semibold">{format(date, "EEE d")}</span>
            {suffix && (
              <span className={cn("text-[9px]", isActive ? "text-primary-foreground/70" : "text-muted-foreground")}>
                {suffix}
              </span>
            )}
            {!suffix && (
              <span className={cn("text-[9px]", isActive ? "text-primary-foreground/70" : "text-muted-foreground")}>
                {format(date, "MMM")}
              </span>
            )}
            {isToday && (
              <span className="text-[8px] font-medium text-blue-500 dark:text-blue-400">
                today
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DisperserCapacityHeatmap({
  batches,
  resources,
  dates,
  bookendDates,
  coreDates,
}: DisperserCapacityHeatmapProps) {
  const [selectedDateIdx, setSelectedDateIdx] = useState<number>(() => {
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const idx = dates.indexOf(todayStr);
    return idx >= 0 ? idx : 0;
  });

  // --- Data computation memos (unchanged logic) ---

  const dispersers = useMemo(
    () =>
      resources
        .filter((r) => r.resourceType === "disperser" && r.active)
        .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999)),
    [resources],
  );

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

  const groupPmcByDate = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const [groupName, memberIds] of groupMembers) {
      const dateMap = new Map<string, number>();
      for (const date of dates) {
        const total = batches
          .filter(
            (b) =>
              b.planDate === date &&
              ((b.planDisperserId != null && memberIds.has(b.planDisperserId)) ||
               (b.planDisperser2Id != null && memberIds.has(b.planDisperser2Id))),
          )
          .reduce((sum, b) => {
            let stagePmc = 0;
            if (b.planDisperserId != null && memberIds.has(b.planDisperserId)) {
              stagePmc += Math.max(b.premixCount ?? 0, 1);
            }
            if (b.planDisperser2Id != null && memberIds.has(b.planDisperser2Id)) {
              stagePmc += Math.max(b.premixCount2 ?? 0, 1);
            }
            return sum + stagePmc;
          }, 0);
        dateMap.set(date, total);
      }
      map.set(groupName, dateMap);
    }
    return map;
  }, [groupMembers, dates, batches]);

  const heatData = useMemo(() => {
    const data = new Map<string, Map<string, CellData>>();

    for (const disperser of dispersers) {
      const dateMap = new Map<string, CellData>();
      const hasGroupCap =
        disperser.groupName != null && disperser.groupCapacity != null;
      const groupCap = disperser.groupCapacity ?? 0;

      for (const date of dates) {
        const dayBatches = batches.filter(
          (b) =>
            b.planDate === date &&
            (b.planDisperserId === disperser.id ||
              b.planDisperser2Id === disperser.id),
        );

        const batchCount = dayBatches.length;
        const pmcTotal = dayBatches.reduce((sum, b) => {
          const pmc =
            b.planDisperser2Id === disperser.id &&
            b.planDisperserId !== disperser.id
              ? Math.max(b.premixCount2 ?? 0, 1)
              : Math.max(b.premixCount ?? 0, 1);
          return sum + pmc;
        }, 0);

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

  // --- Derived values ---

  const firstCoreDate = coreDates?.[0] ?? dates[0] ?? "";
  const coreDateList = useMemo(
    () => dates.filter((d) => !bookendDates.has(d)),
    [dates, bookendDates],
  );
  const selectedDate = dates[selectedDateIdx] ?? dates[0] ?? "";

  function getCell(disperserId: string, date: string): CellData {
    return (
      heatData.get(disperserId)?.get(date) ?? { pmc: 0, batch: 0, cap: 0, pct: 0 }
    );
  }

  function getMaxPctForDate(date: string): number {
    return Math.max(0, ...dispersers.map((d) => getCell(d.id, date).pct));
  }

  // --- Aggregate stats for selected day ---
  const dayStats = useMemo(() => {
    const dk = selectedDate;
    let totalPmc = 0;
    let totalBatch = 0;
    let totalCap = 0;
    for (const d of dispersers) {
      const c = getCell(d.id, dk);
      totalPmc += c.pmc;
      totalBatch += c.batch;
      totalCap += c.cap;
    }
    const totalFree = totalCap - totalPmc;
    const pct = totalCap > 0 ? Math.round((totalPmc / totalCap) * 100) : 0;
    return { totalPmc, totalBatch, totalCap, totalFree: Math.max(0, totalFree), pct };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, dispersers, heatData]);

  // --- Group dispersers by severity for Control Room ---
  const grouped = useMemo(() => {
    const atCap: { d: Resource; c: CellData }[] = [];
    const moderate: { d: Resource; c: CellData }[] = [];
    const idle: { d: Resource; c: CellData }[] = [];
    for (const d of dispersers) {
      const c = getCell(d.id, selectedDate);
      if (c.pct >= 80) atCap.push({ d, c });
      else if (c.pct > 0) moderate.push({ d, c });
      else idle.push({ d, c });
    }
    atCap.sort((a, b) => b.c.pct - a.c.pct);
    moderate.sort((a, b) => b.c.pct - a.c.pct);
    return { atCap, moderate, idle };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, dispersers, heatData]);

  // --- Sorted dispersers for planner ---
  const sortedByPct = useMemo(() => {
    return [...dispersers].sort(
      (a, b) => getCell(b.id, selectedDate).pct - getCell(a.id, selectedDate).pct,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, dispersers, heatData]);

  // --- Sorted dispersers for week view (by peak) ---
  const sortedByPeak = useMemo(() => {
    return [...dispersers].sort((a, b) => {
      const peakA = Math.max(0, ...coreDateList.map((d) => getCell(a.id, d).pct));
      const peakB = Math.max(0, ...coreDateList.map((d) => getCell(b.id, d).pct));
      return peakB - peakA;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispersers, coreDateList, heatData]);

  if (dispersers.length === 0) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <Tabs defaultValue="control">
        <div className="rounded-lg border bg-card">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">
              Disperser Capacity Heat Map
            </h3>
            <TabsList>
              <TabsTrigger value="control" className="text-xs">
                Control Room
              </TabsTrigger>
              <TabsTrigger value="planner" className="text-xs">
                Planner
              </TabsTrigger>
              <TabsTrigger value="week" className="text-xs">
                Week View
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ============================================================ */}
          {/* VIEW 1: CONTROL ROOM                                         */}
          {/* ============================================================ */}
          <TabsContent value="control" className="mt-0">
            <div className="py-3">
              <DayPills
                dates={dates}
                bookendDates={bookendDates}
                firstCoreDate={firstCoreDate}
                selectedDate={selectedDate}
                onSelect={setSelectedDateIdx}
                getMaxPct={getMaxPctForDate}
              />
            </div>

            <div className="px-4 pb-4">
              {/* Fleet summary */}
              <div className="flex items-center gap-6 mb-5">
                <div className="flex-shrink-0">
                  <RingGauge pct={dayStats.pct} size={72} />
                </div>
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className={cn("text-2xl font-bold tabular-nums", getTier(dayStats.pct).textCls)}>
                      {dayStats.pct}%
                    </span>
                    <span className="text-sm text-muted-foreground">resource load</span>
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {dayStats.totalBatch} of {dayStats.totalCap} batch slots in use
                  </div>
                  <div className="mt-2 flex h-2 w-64 gap-0.5 overflow-hidden rounded-full">
                    {grouped.atCap.length > 0 && (
                      <div
                        className="h-full bg-red-500 rounded-full"
                        style={{
                          width: `${(grouped.atCap.reduce((s, x) => s + x.c.batch, 0) / dayStats.totalCap) * 100}%`,
                        }}
                      />
                    )}
                    {grouped.moderate.length > 0 && (
                      <div
                        className="h-full bg-yellow-500 rounded-full"
                        style={{
                          width: `${(grouped.moderate.reduce((s, x) => s + x.c.batch, 0) / dayStats.totalCap) * 100}%`,
                        }}
                      />
                    )}
                    <div className="h-full flex-1 rounded-full bg-muted" />
                  </div>
                </div>
              </div>

              {/* At Capacity */}
              {grouped.atCap.length > 0 && (
                <div className="mb-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-red-500" />
                      <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                        At Capacity
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {grouped.atCap.length} disperser{grouped.atCap.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {grouped.atCap.map(({ d, c }) => (
                      <ControlCard key={d.id} resource={d} cell={c} />
                    ))}
                  </div>
                </div>
              )}

              {/* Moderate */}
              {grouped.moderate.length > 0 && (
                <div className="mb-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-yellow-500" />
                      <span className="text-sm font-semibold text-yellow-600 dark:text-yellow-400">
                        Moderate Load
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {grouped.moderate.length} disperser{grouped.moderate.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {grouped.moderate.map(({ d, c }) => (
                      <ControlCard key={d.id} resource={d} cell={c} />
                    ))}
                  </div>
                </div>
              )}

              {/* Idle */}
              {grouped.idle.length > 0 && (
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                      <span className="text-sm font-semibold text-muted-foreground">Idle</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{grouped.idle.length}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {grouped.idle.map(({ d }) => (
                      <span
                        key={d.id}
                        className="rounded-md border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground"
                      >
                        {d.displayName ?? d.resourceCode}
                        <span className="ml-1 text-[10px]">Cap {d.maxBatchesPerDay}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Legend */}
              <div className="mt-4 border-t pt-3">
                <HeatLegend />
              </div>
            </div>
          </TabsContent>

          {/* ============================================================ */}
          {/* VIEW 2: PLANNER (waffle grid)                                */}
          {/* ============================================================ */}
          <TabsContent value="planner" className="mt-0">
            <div className="py-3">
              <DayPills
                dates={dates}
                bookendDates={bookendDates}
                firstCoreDate={firstCoreDate}
                selectedDate={selectedDate}
                onSelect={setSelectedDateIdx}
                getMaxPct={getMaxPctForDate}
              />
            </div>

            <div className="px-4 pb-4">
              {/* Summary stats */}
              <div className="flex items-center justify-center gap-8 mb-5">
                <div className="text-center">
                  <div className="text-2xl font-bold tabular-nums">{dayStats.totalPmc}</div>
                  <div className="text-[11px] text-muted-foreground">Premixes Planned</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold tabular-nums text-green-600 dark:text-green-400">
                    {dayStats.totalFree}
                  </div>
                  <div className="text-[11px] text-muted-foreground">Available</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold tabular-nums text-muted-foreground">
                    {dayStats.totalCap}
                  </div>
                  <div className="text-[11px] text-muted-foreground">Capacity</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold tabular-nums">{dayStats.totalBatch}</div>
                  <div className="text-[11px] text-muted-foreground">Total Batches</div>
                </div>
              </div>

              {/* Waffle cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {sortedByPct.map((d) => {
                  const c = getCell(d.id, selectedDate);
                  const t = getTier(c.pct);
                  const isIdle = c.pct <= 0;
                  const name = d.displayName ?? d.resourceCode;

                  if (isIdle) {
                    return (
                      <div
                        key={d.id}
                        className="rounded-lg border bg-muted/30 p-3.5 opacity-50"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold">{name}</span>
                          <span className="text-[10px] text-muted-foreground italic">idle</span>
                        </div>
                        <WaffleSquares used={0} cap={c.cap} tier={t} />
                        <div className="text-[10px] text-muted-foreground mt-2">
                          Cap {c.cap}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={d.id}
                      className={cn(
                        "rounded-lg border p-3.5 transition-colors hover:bg-muted/30",
                        t.borderCls,
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold">{name}</span>
                        <span className={cn("text-lg font-bold tabular-nums", t.textCls)}>
                          {c.pct}%
                        </span>
                      </div>
                      <div className="mb-2">
                        <WaffleSquares used={c.batch} cap={c.cap} tier={t} />
                      </div>
                      <div className="text-[10px] text-muted-foreground tabular-nums">
                        {c.pmc} PMC · {c.batch} Batch · {c.cap} Cap
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 text-[10px] text-muted-foreground">
                Each coloured square = 1 used batch slot. Each dim square = 1 free slot.
              </div>
            </div>
          </TabsContent>

          {/* ============================================================ */}
          {/* VIEW 3: WEEK VIEW (wave chart timeline)                      */}
          {/* ============================================================ */}
          <TabsContent value="week" className="mt-0">
            <WeekTimeline
              coreDates={coreDateList}
              sortedByPeak={sortedByPeak}
              getCell={getCell}
            />
          </TabsContent>
        </div>
      </Tabs>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Control Room card
// ---------------------------------------------------------------------------

function ControlCard({ resource, cell }: { resource: Resource; cell: CellData }) {
  const t = getTier(cell.pct);
  const name = resource.displayName ?? resource.resourceCode;
  return (
    <div className={cn("rounded-lg border p-3.5 transition-colors hover:bg-muted/30", t.borderCls)}>
      <div className="text-xs font-semibold mb-1">{name}</div>
      <div className={cn("text-2xl font-bold tabular-nums mb-1", t.textCls)}>{cell.pct}%</div>
      <div className="text-[10px] text-muted-foreground tabular-nums mb-2.5">
        {cell.pmc} PMC · {cell.batch} Batch · {cell.cap} Cap
      </div>
      <div className="h-1 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full", t.barCls)}
          style={{ width: `${Math.min(cell.pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Week Timeline (wave/area chart per disperser)
// ---------------------------------------------------------------------------

function WeekTimeline({
  coreDates,
  sortedByPeak,
  getCell,
}: {
  coreDates: string[];
  sortedByPeak: Resource[];
  getCell: (id: string, date: string) => CellData;
}) {
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const chartH = 44;

  return (
    <div className="overflow-hidden">
      {/* Day headers */}
      <div className="flex items-end border-b" style={{ paddingLeft: 140, paddingRight: 56 }}>
        <div className="flex flex-1">
          {coreDates.map((dk, i) => {
            const date = new Date(dk + "T12:00:00");
            const isToday = dk === todayStr;
            return (
              <div
                key={dk}
                className={cn("flex-1 text-center py-2", i > 0 && "border-l")}
              >
                <span className={cn("text-[10px] font-semibold", isToday ? "text-blue-500 dark:text-blue-400" : "text-muted-foreground")}>
                  {format(date, "EEE d")}
                </span>
                {isToday && (
                  <span className="ml-1 text-[7px] text-blue-500 dark:text-blue-400">
                    today
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Disperser rows */}
      {sortedByPeak.map((resource) => {
        const name = resource.displayName ?? resource.resourceCode;
        const vals = coreDates.map((dk) => getCell(resource.id, dk).pct);
        const peakPct = Math.max(0, ...vals);
        const peakTier = getTier(peakPct);

        // SVG wave path
        const svgW = 680;
        const pts = vals.map((v, i) => ({
          x: ((i + 0.5) / coreDates.length) * svgW,
          y: chartH - 2 - (Math.min(v, 120) / 120) * (chartH - 8),
        }));

        const allPts = [
          { x: 0, y: pts[0]?.y ?? chartH },
          ...pts,
          { x: svgW, y: pts[pts.length - 1]?.y ?? chartH },
        ];

        const first = allPts[0]!;
        let path = `M ${first.x},${first.y}`;
        for (let i = 1; i < allPts.length; i++) {
          const prev = allPts[i - 1]!;
          const curr = allPts[i]!;
          const cpx1 = prev.x + (curr.x - prev.x) * 0.4;
          const cpx2 = prev.x + (curr.x - prev.x) * 0.6;
          path += ` C ${cpx1},${prev.y} ${cpx2},${curr.y} ${curr.x},${curr.y}`;
        }
        const fillPath = `${path} L ${svgW},${chartH} L 0,${chartH} Z`;

        return (
          <div
            key={resource.id}
            className="flex items-center border-b transition-colors hover:bg-muted/20"
            style={{ minHeight: chartH + 16 }}
          >
            {/* Name */}
            <div className="w-[140px] min-w-[140px] flex-shrink-0 border-r px-4">
              <span className="text-xs font-semibold">{name}</span>
            </div>

            {/* Chart */}
            <div className="flex-1 relative" style={{ height: chartH + 8, minWidth: svgW }}>
              <svg
                width="100%"
                height={chartH + 8}
                viewBox={`0 0 ${svgW} ${chartH}`}
                preserveAspectRatio="none"
                className="absolute top-1 left-0"
              >
                {/* Day dividers */}
                {coreDates.slice(1).map((_, i) => (
                  <line
                    key={i}
                    x1={(((i + 1)) / coreDates.length) * svgW}
                    y1={0}
                    x2={(((i + 1)) / coreDates.length) * svgW}
                    y2={chartH}
                    className="stroke-border"
                    strokeWidth={0.5}
                  />
                ))}
                {/* Area fill */}
                <path d={fillPath} fill={peakTier.fill} />
                {/* Line stroke */}
                <path
                  d={path}
                  fill="none"
                  stroke={peakTier.stroke}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
                {/* Data dots */}
                {pts.map((p, i) => {
                  const dk = coreDates[i];
                  if (!dk) return null;
                  const c = getCell(resource.id, dk);
                  if (c.pct <= 0) return null;
                  const ct = getTier(c.pct);
                  return (
                    <circle
                      key={i}
                      cx={p.x}
                      cy={p.y}
                      r={4}
                      fill={ct.stroke}
                      stroke="var(--color-card)"
                      strokeWidth={2}
                    />
                  );
                })}
              </svg>
            </div>

            {/* Peak % */}
            <div className="w-[56px] min-w-[56px] flex-shrink-0 text-right pr-4">
              <span className={cn("text-xs font-bold tabular-nums", peakTier.textCls)}>
                {peakPct}%
              </span>
            </div>
          </div>
        );
      })}

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2.5">
        <HeatLegend />
        <span className="ml-4 text-[10px] text-muted-foreground">
          Colour based on peak utilisation. Dots show active days.
        </span>
      </div>
    </div>
  );
}
