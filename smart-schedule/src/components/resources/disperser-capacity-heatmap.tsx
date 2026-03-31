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

// ---------------------------------------------------------------------------
// Resource group data (driven by groupName + groupCapacity on each resource)
// ---------------------------------------------------------------------------

interface ResourceGroupData {
  groupName: string;
  groupCapacity: number;
  members: { resource: Resource; cell: CellData }[];
  totalPmc: number;
  totalBatch: number;
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
        .filter(
          (r) =>
            r.resourceType === "disperser" &&
            r.active &&
            // Exclude virtual catch-all buckets (e.g. "Straight Mixes", "Intermediates")
            r.maxBatchesPerDay < 99,
        )
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
  const selectedDate = dates[selectedDateIdx] ?? dates[0] ?? "";

  function getCell(disperserId: string, date: string): CellData {
    return (
      heatData.get(disperserId)?.get(date) ?? { pmc: 0, batch: 0, cap: 0, pct: 0 }
    );
  }

  // --- Resource groups from DB groupName + groupCapacity ---
  const resourceGroups = useMemo(() => {
    const groupMap = new Map<string, ResourceGroupData>();

    for (const d of dispersers) {
      const name = d.groupName ?? d.displayName ?? d.resourceCode;
      const cap = d.groupCapacity ?? d.maxBatchesPerDay;
      let entry = groupMap.get(name);
      if (!entry) {
        entry = { groupName: name, groupCapacity: cap, members: [], totalPmc: 0, totalBatch: 0, pct: 0 };
        groupMap.set(name, entry);
      }
      const cell = getCell(d.id, selectedDate);
      entry.members.push({ resource: d, cell });
    }

    for (const entry of groupMap.values()) {
      entry.totalPmc = entry.members.reduce((s, m) => s + m.cell.pmc, 0);
      entry.totalBatch = entry.members.reduce((s, m) => s + m.cell.batch, 0);
      entry.pct = entry.groupCapacity > 0 ? Math.round((entry.totalPmc / entry.groupCapacity) * 100) : 0;
    }

    return [...groupMap.values()].sort((a, b) => b.pct - a.pct);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, dispersers, heatData]);

  // --- Aggregate stats from resource groups ---
  const groupStats = useMemo(() => {
    const totalCap = resourceGroups.reduce((s, g) => s + g.groupCapacity, 0);
    const totalPmc = resourceGroups.reduce((s, g) => s + g.totalPmc, 0);
    const pct = totalCap > 0 ? Math.round((totalPmc / totalCap) * 100) : 0;
    return { totalCap, totalPmc, pct };
  }, [resourceGroups]);

  // --- Planner waffle stats (individual dispersers) ---
  const dayStats = useMemo(() => {
    let totalPmc = 0;
    let totalBatch = 0;
    let totalCap = 0;
    for (const d of dispersers) {
      const c = getCell(d.id, selectedDate);
      totalPmc += c.pmc;
      totalBatch += c.batch;
      totalCap += c.cap;
    }
    const totalFree = totalCap - totalPmc;
    const pct = totalCap > 0 ? Math.round((totalPmc / totalCap) * 100) : 0;
    return { totalPmc, totalBatch, totalCap, totalFree: Math.max(0, totalFree), pct };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, dispersers, heatData]);

  function getMaxPctForDate(date: string): number {
    return Math.max(0, ...dispersers.map((d) => getCell(d.id, date).pct));
  }

  if (dispersers.length === 0) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <Tabs defaultValue="control">
        <div className="rounded-lg border bg-card">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">
              Resource Capacity Overview
            </h3>
            <TabsList>
              <TabsTrigger value="control" className="text-xs">
                Control Room
              </TabsTrigger>
              <TabsTrigger value="planner" className="text-xs">
                Planner
              </TabsTrigger>
              <TabsTrigger value="week" className="text-xs">
                Resource Group
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
              {/* Fleet summary */}
              <div className="flex items-center gap-6 mb-5">
                <div className="flex-shrink-0">
                  <RingGauge pct={groupStats.pct} size={72} />
                </div>
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className={cn("text-2xl font-bold tabular-nums", getTier(groupStats.pct).textCls)}>
                      {groupStats.pct}%
                    </span>
                    <span className="text-sm text-muted-foreground">resource capacity</span>
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {groupStats.totalPmc} of {groupStats.totalCap} slots in use across {resourceGroups.length} groups
                  </div>
                  <div className="mt-2 flex h-2 w-64 gap-0.5 overflow-hidden rounded-full">
                    {(() => {
                      const atCapPmc = resourceGroups.filter((g) => g.pct >= 80).reduce((s, g) => s + g.totalPmc, 0);
                      const moderatePmc = resourceGroups.filter((g) => g.pct > 0 && g.pct < 80).reduce((s, g) => s + g.totalPmc, 0);
                      return (
                        <>
                          {atCapPmc > 0 && (
                            <div className="h-full bg-red-500 rounded-full" style={{ width: `${(atCapPmc / groupStats.totalCap) * 100}%` }} />
                          )}
                          {moderatePmc > 0 && (
                            <div className="h-full bg-yellow-500 rounded-full" style={{ width: `${(moderatePmc / groupStats.totalCap) * 100}%` }} />
                          )}
                        </>
                      );
                    })()}
                    <div className="h-full flex-1 rounded-full bg-muted" />
                  </div>
                </div>
              </div>

              {/* Large groups (2+ members) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
                {resourceGroups
                  .filter((g) => g.members.length >= 2)
                  .map((g) => (
                    <ControlRoomGroupCard key={g.groupName} group={g} />
                  ))}
              </div>

              {/* Small groups (1 member) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                {resourceGroups
                  .filter((g) => g.members.length < 2)
                  .map((g) => (
                    <CompactGroupCard key={g.groupName} group={g} />
                  ))}
              </div>

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
                {resourceGroups.map((g) => {
                  const t = getTier(g.pct);
                  const isIdle = g.pct <= 0;
                  const cap = g.groupCapacity;

                  if (isIdle) {
                    return (
                      <div
                        key={g.groupName}
                        className="rounded-lg border bg-muted/30 p-3.5 opacity-50"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold">{g.groupName}</span>
                          <span className="text-[10px] text-muted-foreground italic">idle</span>
                        </div>
                        <WaffleSquares used={0} cap={cap} tier={t} />
                        <div className="text-[10px] text-muted-foreground mt-2">
                          Cap {cap}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={g.groupName}
                      className={cn(
                        "rounded-lg border p-3.5 transition-colors hover:bg-muted/30",
                        t.borderCls,
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold">{g.groupName}</span>
                        <span className={cn("text-lg font-bold tabular-nums", t.textCls)}>
                          {g.pct}%
                        </span>
                      </div>
                      <div className="mb-2">
                        <WaffleSquares used={g.totalPmc} cap={cap} tier={t} />
                      </div>
                      <div className="text-[10px] text-muted-foreground tabular-nums">
                        {g.totalPmc} PMC · {g.totalBatch} Batch · {cap} Cap
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
          {/* VIEW 3: RESOURCE GROUP                                       */}
          {/* ============================================================ */}
          <TabsContent value="week" className="mt-0">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {resourceGroups.map((group) => (
                  <ControlRoomGroupCard key={group.groupName} group={group} />
                ))}
              </div>
              <div className="mt-4 border-t pt-3">
                <HeatLegend />
              </div>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Control Room group cards
// ---------------------------------------------------------------------------

function ControlRoomGroupCard({ group }: { group: ResourceGroupData }) {
  const t = getTier(group.pct);
  return (
    <div className={cn("rounded-lg border p-4 transition-colors hover:bg-muted/30", t.borderCls)}>
      {/* Group header */}
      <div className="flex items-center gap-3 mb-1">
        <div className="flex-shrink-0">
          <RingGauge pct={group.pct} size={44} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">{group.groupName}</div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {group.totalPmc} premixes · {group.totalBatch} batches · {group.groupCapacity} capacity
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t my-3" />

      {/* Individual resources */}
      <div className="space-y-3">
        {group.members.map(({ resource, cell }) => {
          const grpCap = group.groupCapacity;
          const resPct = grpCap > 0 ? Math.round((cell.pmc / grpCap) * 100) : 0;
          const mt = getTier(resPct);
          return (
            <div key={resource.id}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-sm font-semibold">
                  {resource.displayName ?? resource.resourceCode}
                </span>
                <span className={cn("text-sm font-bold tabular-nums", mt.textCls)}>
                  {resPct}%
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums mb-1">
                <span>{cell.pmc} premixes · {cell.batch} batches</span>
                <span>{cell.pmc} / {grpCap} capacity</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn("h-full rounded-full", mt.barCls)}
                  style={{ width: `${Math.min(resPct, 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompactGroupCard({ group }: { group: ResourceGroupData }) {
  const t = getTier(group.pct);
  return (
    <div className={cn("rounded-lg border p-3.5 transition-colors hover:bg-muted/30", t.borderCls)}>
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0">
          <RingGauge pct={group.pct} size={36} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold">{group.groupName}</div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {group.totalPmc} premixes · {group.totalBatch} batches · {group.groupCapacity} cap
          </div>
        </div>
      </div>
    </div>
  );
}
