/**
 * Bottleneck-strip capacity overview — ported from the Resources Redesign v2 prototype.
 *
 * Replaces the Control Room / Planner / Resource Group tab split in both
 * `mixer-capacity-heatmap.tsx` and `disperser-capacity-heatmap.tsx` with a single
 * ranked view: groups on top, bottleneck-first, drill down to individual units,
 * drill further into each unit's day-by-day bookings.
 *
 * Intended usage in `routes/resources.tsx` (or wherever the existing heatmaps are rendered):
 *
 *   import { BottleneckStrip } from "@/components/resources/bottleneck-strip";
 *   ...
 *   <BottleneckStrip
 *     batches={batches}
 *     resources={resources}
 *     dates={dates}
 *     bookendDates={bookendDates}
 *     coreDates={coreDates}
 *   />
 *
 * and remove the two old heatmaps once you're happy.
 */

import { useMemo, useState, useCallback } from "react";
import { format } from "date-fns";
import { ChevronRight, Flame, Download, Filter as FilterIcon } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Batch } from "@/types/batch";
import type { Resource } from "@/types/resource";

// ─────────────────────────────────────────────────────────────
// Types

interface BottleneckStripProps {
  batches: Batch[];
  resources: Resource[];
  /** Full date range to render — typically 7 days (Sun + Mon–Fri + Sat). */
  dates: string[];
  /** Subset of `dates` that are bookend (fringe) days — rendered muted. */
  bookendDates: Set<string>;
  /** Optional: the core working days. Currently unused for rendering — the strip shows all `dates`. */
  coreDates?: string[];
}

type Kind = "mixer" | "disp";

interface GroupRow {
  key: string;                  // unique (e.g. "mixer:MP-10K")
  name: string;                 // display
  kind: Kind;
  capPerDay: number;            // group capacity per day
  members: Resource[];
  usedByDay: number[];          // one per date — litres for mixer, PMC for disp
  pctByDay: number[];           // rounded %, one per date
  isBookend: boolean[];         // parallel to pctByDay — fringe day flag
  trunkColor: string;
}

interface UnitBookings {
  day: number;
  bookings: Array<{
    id: string;
    batchNo: string;
    product: string;
    volume: number;
    status: Batch["status"];
    stage: "mix" | "disp1" | "disp2";
  }>;
}

// ─────────────────────────────────────────────────────────────
// Colour ramp — indigo → amber → rose (matches the prototype)

function mixHex(a: string, b: string, k: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * k);
  const g = Math.round(((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * k);
  const bl = Math.round((pa & 255) + ((pb & 255) - (pa & 255)) * k);
  return `#${[r, g, bl].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

function heatColor(pct: number): string {
  if (pct <= 0) return "var(--muted)";
  if (pct > 100) return "#b91c1c";
  const t = Math.min(pct / 100, 1);
  return t < 0.5 ? mixHex("#dbeafe", "#f59e0b", t / 0.5) : mixHex("#f59e0b", "#ef4444", (t - 0.5) / 0.5);
}

function tierClass(pct: number): { text: string; bar: string } {
  if (pct > 100) return { text: "text-red-600 dark:text-red-400", bar: "bg-red-500" };
  if (pct > 80) return { text: "text-orange-600 dark:text-orange-400", bar: "bg-orange-500" };
  if (pct > 50) return { text: "text-amber-600 dark:text-amber-400", bar: "bg-amber-500" };
  return { text: "text-indigo-600 dark:text-indigo-400", bar: "bg-indigo-500" };
}

function fmtL(v: number) {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`;
}

// Stable per-trunk colour (approximation — no repo-wide trunk-colour map exists).
const TRUNK_PALETTE = ["#6366f1", "#0ea5e9", "#10b981", "#c0522e", "#f59e0b", "#8b5cf6", "#db2777"];
function trunkColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TRUNK_PALETTE[h % TRUNK_PALETTE.length] ?? "#6366f1";
}

// ─────────────────────────────────────────────────────────────
// Data selectors

function buildMixerGroups(batches: Batch[], resources: Resource[], dates: string[], bookendDates: Set<string>): GroupRow[] {
  const mixers = resources.filter(
    (r) => (r.resourceType === "mixer" || r.resourceType === "pot") && r.active,
  );
  const byTrunk = new Map<string, Resource[]>();
  for (const m of mixers) {
    const key = m.trunkLine ?? m.displayName ?? m.resourceCode;
    if (!byTrunk.has(key)) byTrunk.set(key, []);
    byTrunk.get(key)!.push(m);
  }

  return [...byTrunk.entries()].map(([name, members]) => {
    const capPerDay = members.reduce((s, m) => s + (m.maxCapacity ?? 0), 0);
    const usedByDay = dates.map((d) =>
      batches
        .filter((b) => b.planDate === d && b.planResourceId != null && members.some((m) => m.id === b.planResourceId))
        .reduce((s, b) => s + (b.batchVolume ?? 0), 0),
    );
    const pctByDay = usedByDay.map((u) => (capPerDay > 0 ? Math.round((u / capPerDay) * 100) : 0));
    const isBookend = dates.map((d) => bookendDates.has(d));
    return {
      key: `mixer:${name}`,
      name,
      kind: "mixer" as const,
      capPerDay,
      members,
      usedByDay,
      pctByDay,
      isBookend,
      trunkColor: trunkColor(name),
    };
  });
}

function buildDispGroups(batches: Batch[], resources: Resource[], dates: string[], bookendDates: Set<string>): GroupRow[] {
  const dispersers = resources.filter(
    (r) => r.resourceType === "disperser" && r.active && r.maxBatchesPerDay < 99,
  );
  const byGroup = new Map<string, Resource[]>();
  for (const d of dispersers) {
    const key = d.groupName ?? d.displayName ?? d.resourceCode;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(d);
  }

  return [...byGroup.entries()].map(([name, members]) => {
    const capPerDay = members[0]?.groupCapacity ?? members[0]?.maxBatchesPerDay ?? 0;
    const memberIds = new Set(members.map((m) => m.id));
    const usedByDay = dates.map((d) => {
      const dayBatches = batches.filter(
        (b) =>
          b.planDate === d &&
          ((b.planDisperserId != null && memberIds.has(b.planDisperserId)) ||
            (b.planDisperser2Id != null && memberIds.has(b.planDisperser2Id))),
      );
      return dayBatches.reduce((sum, b) => {
        let pmc = 0;
        if (b.planDisperserId != null && memberIds.has(b.planDisperserId)) pmc += Math.max(b.premixCount ?? 0, 1);
        if (b.planDisperser2Id != null && memberIds.has(b.planDisperser2Id)) pmc += Math.max(b.premixCount2 ?? 0, 1);
        return sum + pmc;
      }, 0);
    });
    const pctByDay = usedByDay.map((u) => (capPerDay > 0 ? Math.round((u / capPerDay) * 100) : 0));
    const isBookend = dates.map((d) => bookendDates.has(d));
    return {
      key: `disp:${name}`,
      name,
      kind: "disp" as const,
      capPerDay,
      members,
      usedByDay,
      pctByDay,
      isBookend,
      trunkColor: "#6366f1",
    };
  });
}

function unitUsageForDay(unit: Resource, group: GroupRow, _dayIdx: number, batches: Batch[], date: string) {
  if (group.kind === "mixer") {
    const lit = batches
      .filter((b) => b.planDate === date && b.planResourceId === unit.id)
      .reduce((s, b) => s + (b.batchVolume ?? 0), 0);
    const cap = unit.maxCapacity ?? 0;
    return { used: lit, cap, pct: cap > 0 ? Math.round((lit / cap) * 100) : 0 };
  } else {
    const dayBatches = batches.filter(
      (b) => b.planDate === date && (b.planDisperserId === unit.id || b.planDisperser2Id === unit.id),
    );
    const pmc = dayBatches.reduce((s, b) => {
      const contrib =
        b.planDisperser2Id === unit.id && b.planDisperserId !== unit.id
          ? Math.max(b.premixCount2 ?? 0, 1)
          : Math.max(b.premixCount ?? 0, 1);
      return s + contrib;
    }, 0);
    const cap = group.capPerDay;
    return { used: pmc, cap, pct: cap > 0 ? Math.round((pmc / cap) * 100) : 0 };
  }
}

function unitBookings(unit: Resource, group: GroupRow, dates: string[], batches: Batch[]): UnitBookings[] {
  return dates.map((date, day) => ({
    day,
    bookings: batches
      .filter((b) => {
        if (b.planDate !== date) return false;
        if (group.kind === "mixer") return b.planResourceId === unit.id;
        return b.planDisperserId === unit.id || b.planDisperser2Id === unit.id;
      })
      .map((b) => ({
        id: b.id,
        batchNo: b.bulkBatchNumber ?? b.sapOrder,
        product: b.materialDescription ?? b.materialCode ?? b.bulkCode ?? "—",
        volume: b.batchVolume ?? 0,
        status: b.status,
        stage:
          group.kind === "mixer"
            ? ("mix" as const)
            : b.planDisperserId === unit.id
              ? ("disp1" as const)
              : ("disp2" as const),
      })),
  }));
}

// ─────────────────────────────────────────────────────────────
// Atomic UI parts

function BigRing({ pct, size = 44 }: { pct: number; size?: number }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const off = c - (c * Math.min(pct, 100)) / 100;
  const { text } = tierClass(pct);
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="stroke-muted" strokeWidth="4" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={heatColor(pct)}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={off}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      {pct > 100 && <circle cx={size - 5} cy={5} r={3.5} fill="#ef4444" stroke="#fff" strokeWidth="1" />}
      <text x={size / 2} y={size / 2 + 3} textAnchor="middle" fontSize="11" fontWeight="700" className={text}>
        {pct}%
      </text>
    </svg>
  );
}

function DayDots({
  pcts,
  dates,
  isBookend,
}: {
  pcts: number[];
  dates: string[];
  isBookend: boolean[];
}) {
  return (
    <div className="flex items-end gap-1">
      {pcts.map((p, i) => {
        const size = 7 + (Math.min(p, 140) / 140) * 22;
        const fringe = isBookend[i];
        return (
          <div
            key={i}
            className={cn(
              "flex flex-col items-center gap-1 rounded-sm px-0.5 py-0.5",
              fringe && "bg-muted/60",
            )}
          >
            <div
              className="rounded-full"
              title={`${dates[i]}${fringe ? " (fringe)" : ""}: ${p}%`}
              style={{
                width: size,
                height: size,
                backgroundColor: heatColor(p),
                opacity: fringe ? 0.7 : 1,
                boxShadow: p > 100 ? "0 0 0 2px rgba(239,68,68,0.35)" : undefined,
              }}
            />
            <span
              className={cn(
                "text-[9px] tabular-nums",
                fringe ? "text-muted-foreground/70 italic" : "text-muted-foreground",
              )}
            >
              {p}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function MiniSpark({
  pctByDay,
  isBookend,
  width = 72,
  height = 20,
}: {
  pctByDay: number[];
  isBookend: boolean[];
  width?: number;
  height?: number;
}) {
  const max = Math.max(120, ...pctByDay);
  const step = width / Math.max(1, pctByDay.length - 1);
  const pts = pctByDay.map((p, i) => `${i * step},${height - (p / max) * height}`).join(" ");
  // Shade fringe-day segments
  const firstCoreIdx = isBookend.findIndex((b) => !b);
  const lastCoreIdx = isBookend.length - 1 - [...isBookend].reverse().findIndex((b) => !b);
  return (
    <svg width={width} height={height} className="overflow-visible">
      {firstCoreIdx > 0 && (
        <rect x={0} y={0} width={firstCoreIdx * step} height={height} className="fill-muted/60" />
      )}
      {lastCoreIdx < isBookend.length - 1 && (
        <rect
          x={lastCoreIdx * step}
          y={0}
          width={width - lastCoreIdx * step}
          height={height}
          className="fill-muted/60"
        />
      )}
      <line
        x1="0"
        x2={width}
        y1={height - (100 / max) * height}
        y2={height - (100 / max) * height}
        className="stroke-border"
        strokeDasharray="2 2"
        strokeWidth="0.6"
      />
      <polyline fill="none" stroke="currentColor" strokeWidth="1.25" points={pts} />
      {pctByDay.map((p, i) => (
        <circle
          key={i}
          cx={i * step}
          cy={height - (p / max) * height}
          r={p > 100 ? 2.2 : 1.4}
          fill={p > 100 ? "#ef4444" : "currentColor"}
          opacity={isBookend[i] ? 0.55 : 1}
        />
      ))}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// Group row

function GroupRowView({
  g,
  dateLabels,
  rawDates,
  open,
  onToggle,
  onOpenUnit,
  batches,
}: {
  g: GroupRow;
  dateLabels: string[];
  rawDates: string[];
  open: boolean;
  onToggle: () => void;
  onOpenUnit: (unit: Resource, g: GroupRow) => void;
  batches: Batch[];
}) {
  // Averages / peaks are computed over core days only — fringe days would dilute the signal.
  const coreIdx = g.isBookend.map((b, i) => (b ? -1 : i)).filter((i) => i >= 0);
  const corePcts = coreIdx.map((i) => g.pctByDay[i] ?? 0);
  const peak = corePcts.length > 0 ? Math.max(...corePcts) : 0;
  const avg = corePcts.length > 0 ? Math.round(corePcts.reduce((a, b) => a + b, 0) / corePcts.length) : 0;
  const overDays = g.pctByDay.filter((p) => p > 100).length;
  const weekTotal = g.usedByDay.reduce((a, b) => a + b, 0);
  const unit = g.kind === "mixer" ? "L" : "PMC";
  return (
    <div>
      <button
        className="grid w-full grid-cols-[20px_44px_1fr_auto_auto_auto_auto] items-center gap-4 px-4 py-2.5 text-left hover:bg-muted/40 transition-colors"
        onClick={onToggle}
      >
        <ChevronRight className={cn("h-3 w-3 text-muted-foreground transition-transform", open && "rotate-90")} />
        <BigRing pct={avg} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-sm shrink-0" style={{ backgroundColor: g.trunkColor }} />
            <span className="text-sm font-bold">{g.name}</span>
            <span className="text-[10.5px] text-muted-foreground">
              {g.members.length} {g.kind === "mixer" ? "mixers" : "dispersers"} · {g.kind === "mixer" ? `${fmtL(g.capPerDay)}L/day` : `${g.capPerDay} slots/day`}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-[10.5px] text-muted-foreground">
            <span>
              week total <span className="font-semibold text-foreground tabular-nums">{g.kind === "mixer" ? `${fmtL(weekTotal)}L` : `${weekTotal} PMC`}</span>
            </span>
            <span>
              avg <span className="font-semibold text-foreground tabular-nums">{avg}%</span>
            </span>
          </div>
        </div>
        <div className="hidden md:flex flex-col items-end gap-0.5 text-foreground">
          <MiniSpark pctByDay={g.pctByDay} isBookend={g.isBookend} />
          <span className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">7-day</span>
        </div>
        <DayDots pcts={g.pctByDay} dates={dateLabels} isBookend={g.isBookend} />
        <div className="flex flex-col items-center min-w-[44px]">
          <span className={cn("text-[15px] font-bold tabular-nums leading-none", peak > 100 ? "text-red-600 dark:text-red-400" : "text-foreground")}>
            {peak}%
          </span>
          <span className="mt-1 text-[9.5px] uppercase tracking-wide text-muted-foreground">peak</span>
        </div>
        <div className="flex flex-col items-center min-w-[44px]">
          <span className={cn("text-[15px] font-bold tabular-nums leading-none", overDays > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
            {overDays}
          </span>
          <span className="mt-1 text-[9.5px] uppercase tracking-wide text-muted-foreground">over</span>
        </div>
      </button>
      {open && (
        <div className="bg-muted/30 border-t px-4 py-3 space-y-1">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            individual units · click any row for booking detail
          </div>
          {g.members.map((m) => {
            const perDay = rawDates.map((d, i) => unitUsageForDay(m, g, i, batches, d));
            const peakU = Math.max(...perDay.map((x) => x.pct));
            const unitSum = perDay.reduce((s, x) => s + x.used, 0);
            void (g.kind === "mixer" ? m.maxCapacity ?? 0 : g.capPerDay); // available for display if needed
            return (
              <button
                key={m.id}
                onClick={() => onOpenUnit(m, g)}
                className="group grid w-full grid-cols-[90px_1fr_80px_44px_20px] items-center gap-3 rounded-md bg-card px-2.5 py-1.5 ring-1 ring-inset ring-border hover:ring-foreground/40 transition"
              >
                <span className="font-mono text-[11px] font-semibold text-left">{m.resourceCode}</span>
                <div className="flex items-center gap-1">
                  {perDay.map((x, i) => {
                    const fringe = g.isBookend[i];
                    return (
                      <div
                        key={i}
                        className={cn(
                          "flex h-6 flex-1 items-center justify-center rounded text-[10px] font-bold tabular-nums",
                          fringe && "ring-1 ring-inset ring-dashed ring-border/80",
                        )}
                        title={`${dateLabels[i]}${fringe ? " (fringe)" : ""}: ${x.pct}% (${x.used}/${x.cap}${unit === "L" ? "L" : ""})`}
                        style={{
                          backgroundColor: heatColor(x.pct),
                          color: x.pct > 60 ? "#fff" : "inherit",
                          opacity: fringe ? 0.7 : 1,
                        }}
                      >
                        {x.pct}
                      </div>
                    );
                  })}
                </div>
                <span className="text-right text-[10.5px] text-muted-foreground tabular-nums">
                  {g.kind === "mixer" ? `${fmtL(unitSum)}L` : `${unitSum} PMC`}
                </span>
                <span className={cn("text-right text-[11px] font-bold tabular-nums", peakU > 100 && "text-red-600 dark:text-red-400")}>{peakU}%</span>
                <ChevronRight className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Unit detail drawer

function UnitDetail({
  unit,
  group,
  dates,
  bookendDates,
  batches,
  onClose,
}: {
  unit: Resource;
  group: GroupRow;
  dates: string[];
  bookendDates: Set<string>;
  batches: Batch[];
  onClose: () => void;
}) {
  const perDay = dates.map((d, i) => unitUsageForDay(unit, group, i, batches, d));
  const bookingsByDay = unitBookings(unit, group, dates, batches);
  const coreIdx = dates.map((d, i) => (bookendDates.has(d) ? -1 : i)).filter((i) => i >= 0);
  const corePcts = coreIdx.map((i) => perDay[i]?.pct ?? 0);
  const weekAvg = corePcts.length > 0 ? Math.round(corePcts.reduce((s, p) => s + p, 0) / corePcts.length) : 0;
  const peak = corePcts.length > 0 ? Math.max(...corePcts) : 0;
  const nBookings = bookingsByDay.reduce((s, d) => s + d.bookings.length, 0);
  const capLabel = group.kind === "mixer" ? `${fmtL(unit.maxCapacity ?? 0)}L/day` : `${group.capPerDay} PMC/day`;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="w-[560px] max-w-[92vw] bg-background border-l flex flex-col shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: group.trunkColor }} />
              <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                {group.kind} · {group.name}
              </span>
            </div>
            <h2 className="mt-1 text-[17px] font-bold tracking-tight">{unit.displayName ?? unit.resourceCode}</h2>
            <p className="text-[11.5px] text-muted-foreground">
              capacity <span className="font-semibold text-foreground tabular-nums">{capLabel}</span>
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-px bg-border">
          {[
            { label: "core avg", value: weekAvg, suffix: "%" },
            { label: "peak day", value: peak, suffix: "%", over: peak > 100 },
            { label: "bookings", value: nBookings, suffix: "" },
          ].map((k, i) => (
            <div key={i} className="bg-background px-5 py-3">
              <p className="text-[9.5px] uppercase tracking-wide text-muted-foreground">{k.label}</p>
              <p className={cn("mt-0.5 text-[20px] font-bold tabular-nums leading-none", k.over && "text-red-600 dark:text-red-400")}>
                {k.value}
                {k.suffix}
              </p>
            </div>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {dates.map((d, dayIdx) => {
            const dayDate = new Date(d + "T12:00:00");
            const dayPct = perDay[dayIdx]?.pct ?? 0;
            const dayUsed = perDay[dayIdx]?.used ?? 0;
            const dayCap = perDay[dayIdx]?.cap ?? 0;
            const book = bookingsByDay[dayIdx]?.bookings ?? [];
            const fringe = bookendDates.has(d);
            return (
              <div key={d} className={cn("border-b", fringe && "bg-muted/20") }>
                <div className={cn("sticky top-0 z-10 flex items-center justify-between gap-2 px-5 py-2 border-b", fringe ? "bg-muted/40" : "bg-background") }>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[12px] font-bold">{format(dayDate, "EEE d MMM")}</span>
                    {fringe && (
                      <span className="rounded-sm bg-background px-1.5 py-px font-mono text-[9px] uppercase tracking-wide text-muted-foreground ring-1 ring-inset ring-border">
                        fringe
                      </span>
                    )}
                    <span className="text-[10.5px] text-muted-foreground tabular-nums">
                      {group.kind === "mixer" ? `${fmtL(dayUsed)}L of ${fmtL(dayCap)}L` : `${dayUsed} of ${dayCap} PMC`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative h-1.5 w-28 overflow-hidden rounded-full bg-muted">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ width: `${Math.min(dayPct, 140) / 1.4}%`, backgroundColor: heatColor(dayPct) }}
                      />
                      <div className="absolute top-0 bottom-0 w-px bg-foreground/30" style={{ left: `${100 / 1.4}%` }} />
                    </div>
                    <span className={cn("text-[11.5px] font-bold tabular-nums min-w-[36px] text-right", dayPct > 100 && "text-red-600 dark:text-red-400")}>{dayPct}%</span>
                  </div>
                </div>
                {book.length === 0 ? (
                  <div className="px-5 py-3 text-[11.5px] text-muted-foreground italic">— idle —</div>
                ) : (
                  <div className="space-y-1 px-3 py-2">
                    {book.map((b) => (
                      <div key={b.id} className="grid grid-cols-[64px_6px_1fr_auto_auto] items-center gap-2 rounded-md bg-card px-2 py-1.5 ring-1 ring-inset ring-border">
                        <span className="font-mono text-[11px] tabular-nums truncate">{b.batchNo}</span>
                        <span className="h-6 w-[3px] rounded-sm" style={{ backgroundColor: group.trunkColor }} />
                        <span className="min-w-0 truncate text-[11.5px] font-semibold">{b.product}</span>
                        <Badge variant="outline" className="text-[9.5px] tabular-nums">
                          {b.status}
                        </Badge>
                        <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
                          {group.kind === "mixer" ? `${fmtL(b.volume)}L` : b.stage === "disp1" ? "S1" : "S2"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main component

export function BottleneckStrip({
  batches,
  resources,
  dates,
  bookendDates,
  coreDates,
}: BottleneckStripProps) {
  // Render ALL days (7: Sun + Mon–Fri + Sat). Fringe days get muted styling.
  const stripDates = dates;

  const [kind, setKind] = useState<"all" | "mixer" | "disp">("all");
  const [onlyOver, setOnlyOver] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<Set<string> | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [openUnit, setOpenUnit] = useState<{ unit: Resource; group: GroupRow } | null>(null);

  const mixerGroups = useMemo(
    () => buildMixerGroups(batches, resources, stripDates, bookendDates),
    [batches, resources, stripDates, bookendDates],
  );
  const dispGroups = useMemo(
    () => buildDispGroups(batches, resources, stripDates, bookendDates),
    [batches, resources, stripDates, bookendDates],
  );
  // Silence unused-var lint for coreDates — kept in the API for forward compat.
  void coreDates;

  const allGroupKeys = useMemo(() => [...mixerGroups, ...dispGroups].map((g) => g.key), [mixerGroups, dispGroups]);
  const effectiveSel = selectedGroups ?? new Set(allGroupKeys);

  const filterFn = useCallback(
    (g: GroupRow) => {
      if (kind === "mixer" && g.kind !== "mixer") return false;
      if (kind === "disp" && g.kind !== "disp") return false;
      if (!effectiveSel.has(g.key)) return false;
      if (onlyOver && g.pctByDay.every((p) => p <= 100)) return false;
      return true;
    },
    [kind, effectiveSel, onlyOver],
  );

  // Sort uses core days only so a quiet Saturday doesn't push a real bottleneck down the list.
  const corePcts = (g: GroupRow) => g.pctByDay.filter((_, i) => !g.isBookend[i]);
  const sortFn = (a: GroupRow, b: GroupRow) => {
    const ao = corePcts(a).filter((p) => p > 100).length;
    const bo = corePcts(b).filter((p) => p > 100).length;
    if (ao !== bo) return bo - ao;
    const ap = Math.max(0, ...corePcts(a));
    const bp = Math.max(0, ...corePcts(b));
    return bp - ap;
  };

  const mixersShown = mixerGroups.filter(filterFn).sort(sortFn);
  const dispsShown = dispGroups.filter(filterFn).sort(sortFn);
  const all = [...mixersShown, ...dispsShown];

  const kpi = {
    peak: all.length > 0 ? Math.max(0, ...all.flatMap((g) => corePcts(g))) : 0,
    overDays: all.reduce((s, g) => s + g.pctByDay.filter((p) => p > 100).length, 0),
    groupsOver: all.filter((g) => g.pctByDay.some((p) => p > 100)).length,
  };

  const dateLabels = stripDates.map((d) => format(new Date(d + "T12:00:00"), "EEE d"));

  const headerRow = (
    <div className="grid grid-cols-[20px_44px_1fr_auto_auto_auto_auto] gap-4 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground bg-muted/50 border-y">
      <span />
      <span className="text-center">avg</span>
      <span>group · click to expand</span>
      <span className="hidden md:block text-right">trend</span>
      <div className="flex items-center gap-1 justify-center">
        {stripDates.map((d, i) => {
          const fringe = bookendDates.has(d);
          return (
            <span
              key={d}
              className={cn(
                "rounded px-1 py-0.5 min-w-[34px] text-center tabular-nums",
                fringe ? "text-muted-foreground/70 italic" : "text-muted-foreground",
              )}
              title={fringe ? "Fringe day" : undefined}
            >
              {dateLabels[i]}
            </span>
          );
        })}
      </div>
      <span className="text-center">peak</span>
      <span className="text-center">over</span>
    </div>
  );

  return (
    <div className="rounded-lg border bg-card">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b">
        <div className="inline-flex rounded-md bg-muted p-0.5">
          {(["all", "mixer", "disp"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={cn(
                "rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium transition",
                kind === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {k === "all" ? "All" : k === "mixer" ? "Mixers" : "Dispersers"}
            </button>
          ))}
        </div>

        <button
          onClick={() => setOnlyOver(!onlyOver)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium ring-1 ring-inset transition",
            onlyOver ? "bg-red-50 text-red-700 ring-red-300 dark:bg-red-950/40 dark:text-red-400" : "bg-background ring-border text-muted-foreground hover:text-foreground",
          )}
        >
          <Flame className="h-3 w-3" />
          {onlyOver ? "Only over capacity" : "Show over capacity"}
        </button>

        <div className="ml-auto flex items-center gap-4">
          <Kpi label="peak" value={`${kpi.peak}%`} over={kpi.peak > 100} />
          <Kpi label="over-days" value={kpi.overDays} over={kpi.overDays > 0} />
          <Kpi label="groups over" value={kpi.groupsOver} over={kpi.groupsOver > 0} />
          <Button size="sm" variant="outline">
            <Download className="mr-1 h-3.5 w-3.5" /> Export
          </Button>
        </div>

        <div className="basis-full flex flex-wrap items-center gap-1.5 pt-2 border-t mt-1 -mx-4 px-4">
          <FilterIcon className="h-3 w-3 text-muted-foreground" />
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground mr-1">Groups</span>
          <button onClick={() => setSelectedGroups(new Set(allGroupKeys))} className="rounded-md bg-muted px-2 py-0.5 text-[10.5px] text-muted-foreground hover:text-foreground">
            all
          </button>
          <button onClick={() => setSelectedGroups(new Set())} className="rounded-md bg-muted px-2 py-0.5 text-[10.5px] text-muted-foreground hover:text-foreground">
            none
          </button>
          <span className="mx-1 text-muted-foreground">·</span>
          {[...mixerGroups, ...dispGroups].map((g) => {
            const active = effectiveSel.has(g.key);
            return (
              <button
                key={g.key}
                onClick={() => {
                  const n = new Set(effectiveSel);
                  n.has(g.key) ? n.delete(g.key) : n.add(g.key);
                  setSelectedGroups(n);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset transition",
                  active ? "bg-foreground text-background ring-foreground" : "bg-background text-muted-foreground ring-border hover:ring-foreground/40 hover:text-foreground",
                )}
              >
                <span className="h-1.5 w-1.5 rounded-sm" style={{ backgroundColor: g.trunkColor }} />
                {g.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Mixer block */}
      {(kind === "all" || kind === "mixer") && mixersShown.length > 0 && (
        <>
          <div className="px-4 py-2.5 border-b">
            <div className="text-sm font-semibold uppercase tracking-wide">Mixer capacity</div>
            <div className="text-[11.5px] text-muted-foreground">Per trunk · ring = 5-day avg · dot size = daily load · sparkline = intra-week drift.</div>
          </div>
          {headerRow}
          <div className="divide-y">
            {mixersShown.map((g) => (
              <GroupRowView
                key={g.key}
                g={g}
                dateLabels={dateLabels}
                rawDates={stripDates}
                open={openKey === g.key}
                onToggle={() => setOpenKey(openKey === g.key ? null : g.key)}
                onOpenUnit={(unit, group) => setOpenUnit({ unit, group })}
                batches={batches}
              />
            ))}
          </div>
        </>
      )}

      {/* Disperser block */}
      {(kind === "all" || kind === "disp") && dispsShown.length > 0 && (
        <>
          <div className="px-4 py-2.5 border-b border-t">
            <div className="text-sm font-semibold uppercase tracking-wide">Disperser capacity</div>
            <div className="text-[11.5px] text-muted-foreground">Shared group capacity · one row per group.</div>
          </div>
          {headerRow}
          <div className="divide-y">
            {dispsShown.map((g) => (
              <GroupRowView
                key={g.key}
                g={g}
                dateLabels={dateLabels}
                rawDates={stripDates}
                open={openKey === g.key}
                onToggle={() => setOpenKey(openKey === g.key ? null : g.key)}
                onOpenUnit={(unit, group) => setOpenUnit({ unit, group })}
                batches={batches}
              />
            ))}
          </div>
        </>
      )}

      {all.length === 0 && (
        <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">No groups match the current filter.</div>
      )}

      {openUnit && (
        <UnitDetail
          unit={openUnit.unit}
          group={openUnit.group}
          dates={stripDates}
          bookendDates={bookendDates}
          batches={batches}
          onClose={() => setOpenUnit(null)}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, over }: { label: string; value: string | number; over?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={cn("text-[14px] font-bold tabular-nums leading-none", over ? "text-red-600 dark:text-red-400" : "text-foreground")}>{value}</span>
      <span className="text-[9.5px] uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}
