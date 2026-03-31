import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Batch } from "@/types/batch";
import type { Resource } from "@/types/resource";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MixerCapacityHeatmapProps {
  batches: Batch[];
  resources: Resource[];
  dates: string[];
  bookendDates: Set<string>;
  coreDates?: string[];
}

interface MixerCellData {
  litres: number;
  items: number;
  capacity: number; // maxCapacity in litres
  pct: number;
}

interface TrunkGroupData {
  trunkName: string;
  totalCapacity: number; // sum of maxCapacity across all mixers in trunk
  members: { resource: Resource; cell: MixerCellData }[];
  totalLitres: number;
  totalItems: number;
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

function formatLitres(litres: number): string {
  if (litres >= 1000) {
    return `${(litres / 1000).toFixed(1)}k`;
  }
  return `${Math.round(litres)}`;
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

export function MixerCapacityHeatmap({
  batches,
  resources,
  dates,
  bookendDates,
  coreDates,
}: MixerCapacityHeatmapProps) {
  const [selectedDateIdx, setSelectedDateIdx] = useState<number>(() => {
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const idx = dates.indexOf(todayStr);
    return idx >= 0 ? idx : 0;
  });

  const [collapsed, setCollapsed] = useState(false);

  // --- Filter to active mixers ---
  const mixers = useMemo(
    () =>
      resources
        .filter((r) => r.resourceType === "mixer" && r.active)
        .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999)),
    [resources],
  );

  // --- Compute per-mixer cell data for each date ---
  const heatData = useMemo(() => {
    const data = new Map<string, Map<string, MixerCellData>>();

    for (const mixer of mixers) {
      const dateMap = new Map<string, MixerCellData>();
      const capacity = mixer.maxCapacity ?? 0;

      for (const date of dates) {
        const dayBatches = batches.filter(
          (b) => b.planDate === date && b.planResourceId === mixer.id,
        );

        const items = dayBatches.length;
        const litres = dayBatches.reduce(
          (sum, b) => sum + (b.batchVolume ?? 0),
          0,
        );
        const pct = capacity > 0 ? Math.round((litres / capacity) * 100) : 0;

        dateMap.set(date, { litres, items, capacity, pct });
      }

      data.set(mixer.id, dateMap);
    }

    return data;
  }, [mixers, dates, batches]);

  // --- Derived values ---
  const firstCoreDate = coreDates?.[0] ?? dates[0] ?? "";
  const selectedDate = dates[selectedDateIdx] ?? dates[0] ?? "";

  function getCell(mixerId: string, date: string): MixerCellData {
    return (
      heatData.get(mixerId)?.get(date) ?? { litres: 0, items: 0, capacity: 0, pct: 0 }
    );
  }

  // --- Trunk groups from DB trunkLine ---
  const trunkGroups = useMemo(() => {
    const groupMap = new Map<string, TrunkGroupData>();

    for (const m of mixers) {
      const trunkName = m.trunkLine ?? m.displayName ?? m.resourceCode;
      let entry = groupMap.get(trunkName);
      if (!entry) {
        entry = {
          trunkName,
          totalCapacity: 0,
          members: [],
          totalLitres: 0,
          totalItems: 0,
          pct: 0,
        };
        groupMap.set(trunkName, entry);
      }
      const cell = getCell(m.id, selectedDate);
      entry.members.push({ resource: m, cell });
    }

    // Compute totals per trunk
    for (const entry of groupMap.values()) {
      entry.totalCapacity = entry.members.reduce(
        (s, m) => s + (m.resource.maxCapacity ?? 0),
        0,
      );
      entry.totalLitres = entry.members.reduce((s, m) => s + m.cell.litres, 0);
      entry.totalItems = entry.members.reduce((s, m) => s + m.cell.items, 0);
      entry.pct =
        entry.totalCapacity > 0
          ? Math.round((entry.totalLitres / entry.totalCapacity) * 100)
          : 0;
    }

    return [...groupMap.values()].sort((a, b) => b.pct - a.pct);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, mixers, heatData]);

  // --- Aggregate stats ---
  const fleetStats = useMemo(() => {
    const totalCap = trunkGroups.reduce((s, g) => s + g.totalCapacity, 0);
    const totalLitres = trunkGroups.reduce((s, g) => s + g.totalLitres, 0);
    const totalItems = trunkGroups.reduce((s, g) => s + g.totalItems, 0);
    const pct = totalCap > 0 ? Math.round((totalLitres / totalCap) * 100) : 0;
    return { totalCap, totalLitres, totalItems, pct };
  }, [trunkGroups]);

  function getMaxPctForDate(date: string): number {
    let maxPct = 0;
    for (const m of mixers) {
      const cell = getCell(m.id, date);
      if (cell.pct > maxPct) maxPct = cell.pct;
    }
    return maxPct;
  }

  if (mixers.length === 0) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <Tabs defaultValue="control">
        <div className="rounded-lg border bg-card">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="flex items-center gap-2 hover:opacity-70 transition-opacity"
            >
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform duration-200",
                  collapsed && "-rotate-90",
                )}
              />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">
                Mixer Capacity Overview
              </h3>
            </button>
            {!collapsed && (
              <TabsList>
                <TabsTrigger value="control" className="text-xs">
                  Control Room
                </TabsTrigger>
                <TabsTrigger value="trunk" className="text-xs">
                  Trunk View
                </TabsTrigger>
              </TabsList>
            )}
          </div>

          {!collapsed && (
          <>
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
                  <RingGauge pct={fleetStats.pct} size={72} />
                </div>
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className={cn("text-2xl font-bold tabular-nums", getTier(fleetStats.pct).textCls)}>
                      {fleetStats.pct}%
                    </span>
                    <span className="text-sm text-muted-foreground">mixer capacity</span>
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {formatLitres(fleetStats.totalLitres)}L of {formatLitres(fleetStats.totalCap)}L across {trunkGroups.length} trunks · {fleetStats.totalItems} items
                  </div>
                  <div className="mt-2 flex h-2 w-64 gap-0.5 overflow-hidden rounded-full">
                    {(() => {
                      const atCapLitres = trunkGroups.filter((g) => g.pct >= 80).reduce((s, g) => s + g.totalLitres, 0);
                      const moderateLitres = trunkGroups.filter((g) => g.pct > 0 && g.pct < 80).reduce((s, g) => s + g.totalLitres, 0);
                      return (
                        <>
                          {atCapLitres > 0 && (
                            <div className="h-full bg-red-500 rounded-full" style={{ width: `${(atCapLitres / fleetStats.totalCap) * 100}%` }} />
                          )}
                          {moderateLitres > 0 && (
                            <div className="h-full bg-yellow-500 rounded-full" style={{ width: `${(moderateLitres / fleetStats.totalCap) * 100}%` }} />
                          )}
                        </>
                      );
                    })()}
                    <div className="h-full flex-1 rounded-full bg-muted" />
                  </div>
                </div>
              </div>

              {/* Trunk group cards (2+ members) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
                {trunkGroups
                  .filter((g) => g.members.length >= 2)
                  .map((g) => (
                    <TrunkGroupCard key={g.trunkName} group={g} />
                  ))}
              </div>

              {/* Small trunk groups (1 member) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                {trunkGroups
                  .filter((g) => g.members.length < 2)
                  .map((g) => (
                    <CompactTrunkCard key={g.trunkName} group={g} />
                  ))}
              </div>

              {/* Legend */}
              <div className="mt-4 border-t pt-3">
                <HeatLegend />
              </div>
            </div>
          </TabsContent>

          {/* ============================================================ */}
          {/* VIEW 2: TRUNK VIEW                                           */}
          {/* ============================================================ */}
          <TabsContent value="trunk" className="mt-0">
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
                {trunkGroups.map((group) => (
                  <TrunkGroupCard key={group.trunkName} group={group} />
                ))}
              </div>
              <div className="mt-4 border-t pt-3">
                <HeatLegend />
              </div>
            </div>
          </TabsContent>
          </>
          )}
        </div>
      </Tabs>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Trunk group cards
// ---------------------------------------------------------------------------

function TrunkGroupCard({ group }: { group: TrunkGroupData }) {
  const t = getTier(group.pct);
  return (
    <div className={cn("rounded-lg border p-4 transition-colors hover:bg-muted/30", t.borderCls)}>
      {/* Group header */}
      <div className="flex items-center gap-3 mb-1">
        <div className="flex-shrink-0">
          <RingGauge pct={group.pct} size={44} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold">{group.trunkName}</span>
            <span className={cn("text-sm font-bold tabular-nums", t.textCls)}>
              {group.pct}%
            </span>
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {formatLitres(group.totalLitres)}L · {group.totalItems} items · {formatLitres(group.totalCapacity)}L capacity
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t my-3" />

      {/* Individual mixers */}
      <div className="space-y-3">
        {group.members.map(({ resource, cell }) => {
          const mixerCap = resource.maxCapacity ?? 0;
          const resPct = mixerCap > 0 ? Math.round((cell.litres / mixerCap) * 100) : 0;
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
                <span>{formatLitres(cell.litres)}L · {cell.items} items</span>
                <span>{formatLitres(cell.litres)}L / {formatLitres(mixerCap)}L capacity</span>
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

function CompactTrunkCard({ group }: { group: TrunkGroupData }) {
  const t = getTier(group.pct);
  return (
    <div className={cn("rounded-lg border p-3.5 transition-colors hover:bg-muted/30", t.borderCls)}>
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0">
          <RingGauge pct={group.pct} size={36} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold">{group.trunkName}</div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {formatLitres(group.totalLitres)}L · {group.totalItems} items · {formatLitres(group.totalCapacity)}L cap
          </div>
        </div>
      </div>
    </div>
  );
}
