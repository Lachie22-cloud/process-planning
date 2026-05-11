/**
 * Capacity Overview — Traffic-Light Wall
 *
 * Ported from the "V4 Traffic light wall" prototype in `Resources Readable Redesign.html`.
 *
 * Replaces the existing `mixer-capacity-heatmap.tsx` + `disperser-capacity-heatmap.tsx`
 * (or whichever wide-grid component is currently used on the Resources page) with a
 * large, distance-readable layout: one row per trunk/group, five chunky tiles
 * (one per weekday) showing % load, drill-down to each individual unit (mixer or
 * disperser) using the same tile vocabulary.
 *
 *  <CapacityOverviewWall
 *     batches={batches}
 *     resources={resources}
 *     dates={dates}            // 7-day range
 *     bookendDates={bookendDates}
 *  />
 *
 * - Aggregate metrics (avg, peak, sort order) use core days only — fringe Sat/Sun
 *   never push a real weekday bottleneck off the top.
 * - Display includes all 7 days — fringe day tiles are de-saturated and italic.
 */

import { useMemo, useState, useCallback } from "react";
import { format } from "date-fns";
import { ChevronRight, Check, Minus, AlertTriangle, X as XIcon } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import type { Batch } from "@/types/batch";
import type { Resource } from "@/types/resource";

// ─────────────────────────────────────────────────────────────
// Props

export interface CapacityOverviewWallProps {
  batches: Batch[];
  resources: Resource[];
  /** Full date range to render (typically 7 days: Sun + Mon–Fri + Sat). */
  dates: string[];
  /** Subset of `dates` that are fringe / bookend days — rendered muted. */
  bookendDates: Set<string>;
  /** Which section to show. Omit to show both. */
  kind?: "mixer" | "disp" | "all";
}

type Kind = "mixer" | "disp";

interface GroupRow {
  key: string;
  name: string;
  kind: Kind;
  capPerDay: number;
  members: Resource[];
  usedByDay: number[];
  pctByDay: number[];
  isBookend: boolean[];
}

// ─────────────────────────────────────────────────────────────
// Status palette

type StatusKey = "easy" | "busy" | "tight" | "over";
interface StatusTone {
  key: StatusKey;
  label: string;
  /** Solid tile background */
  solid: string;
  /** Light tinted background for status pill */
  bg: string;
  /** Strong text colour for status pill */
  fg: string;
  /** Soft soft border / ring colour */
  soft: string;
}
const STATUS: StatusTone[] = [
  { key: "easy",  label: "Easy",  solid: "#10b981", bg: "#ecfdf5", fg: "#047857", soft: "#a7f3d0" },
  { key: "busy",  label: "Busy",  solid: "#eab308", bg: "#fef9c3", fg: "#854d0e", soft: "#fde68a" },
  { key: "tight", label: "Tight", solid: "#f97316", bg: "#ffedd5", fg: "#9a3412", soft: "#fed7aa" },
  { key: "over",  label: "Over",  solid: "#dc2626", bg: "#fee2e2", fg: "#b91c1c", soft: "#fecaca" },
];

function statusOf(pct: number): StatusTone {
  if (pct <= 60) return STATUS[0]!;
  if (pct <= 85) return STATUS[1]!;
  if (pct <= 100) return STATUS[2]!;
  return STATUS[3]!;
}

function fmtL(v: number) {
  return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `${Math.round(v)}`;
}

function pctOf(used: number, cap: number) {
  return cap > 0 ? Math.round((used / cap) * 100) : 0;
}

// ─────────────────────────────────────────────────────────────
// Data selectors — mirror the legacy heatmap logic 1:1

function buildMixerGroups(
  batches: Batch[],
  resources: Resource[],
  dates: string[],
  bookendDates: Set<string>,
): GroupRow[] {
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
    return {
      key: `mixer:${name}`,
      name,
      kind: "mixer",
      capPerDay,
      members,
      usedByDay,
      pctByDay: usedByDay.map((u) => pctOf(u, capPerDay)),
      isBookend: dates.map((d) => bookendDates.has(d)),
    };
  });
}

function buildDispGroups(
  batches: Batch[],
  resources: Resource[],
  dates: string[],
  bookendDates: Set<string>,
): GroupRow[] {
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
    return {
      key: `disp:${name}`,
      name,
      kind: "disp",
      capPerDay,
      members,
      usedByDay,
      pctByDay: usedByDay.map((u) => pctOf(u, capPerDay)),
      isBookend: dates.map((d) => bookendDates.has(d)),
    };
  });
}

function unitDailyPcts(unit: Resource, group: GroupRow, dates: string[], batches: Batch[]) {
  return dates.map((d) => {
    if (group.kind === "mixer") {
      const used = batches
        .filter((b) => b.planDate === d && b.planResourceId === unit.id)
        .reduce((s, b) => s + (b.batchVolume ?? 0), 0);
      const cap = unit.maxCapacity ?? 0;
      return { used, cap, pct: pctOf(used, cap) };
    }
    const dayBatches = batches.filter(
      (b) => b.planDate === d && (b.planDisperserId === unit.id || b.planDisperser2Id === unit.id),
    );
    const used = dayBatches.reduce((s, b) => {
      const contrib =
        b.planDisperser2Id === unit.id && b.planDisperserId !== unit.id
          ? Math.max(b.premixCount2 ?? 0, 1)
          : Math.max(b.premixCount ?? 0, 1);
      return s + contrib;
    }, 0);
    return { used, cap: group.capPerDay, pct: pctOf(used, group.capPerDay) };
  });
}

// ─────────────────────────────────────────────────────────────
// Icons

function StatusIcon({ kind, size = 13 }: { kind: StatusKey; size?: number }) {
  const props = { width: size, height: size, strokeWidth: 3 } as const;
  if (kind === "easy") return <Check {...props} />;
  if (kind === "busy") return <Minus {...props} />;
  if (kind === "tight") return <AlertTriangle {...props} />;
  return <XIcon {...props} />;
}

// ─────────────────────────────────────────────────────────────
// Tiles

function GroupDayTile({
  pct,
  dayLabel,
  isPeak,
  isBookend,
}: {
  pct: number;
  dayLabel: string;
  isPeak: boolean;
  isBookend: boolean;
}) {
  const s = statusOf(pct);
  const over = pct > 100;
  return (
    <div
      className={cn(
        "relative flex h-20 flex-col items-center justify-center rounded-xl border-[3px]",
        isBookend && "opacity-65",
      )}
      style={{
        backgroundColor: s.solid,
        borderColor: isPeak ? "#0f172a" : s.solid,
        backgroundImage: over
          ? "repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(255,255,255,0.30) 5px, rgba(255,255,255,0.30) 10px)"
          : undefined,
      }}
    >
      <div className="absolute top-1.5 right-1.5 text-white/85">
        <StatusIcon kind={s.key} />
      </div>
      <div
        className={cn(
          "absolute top-1.5 left-2 text-[10px] font-bold uppercase tracking-wide text-white/85",
          isBookend && "italic",
        )}
      >
        {dayLabel}
      </div>
      <div
        className="text-[28px] font-bold leading-none tabular-nums text-white"
        style={{ textShadow: "0 1px 2px rgba(0,0,0,0.18)" }}
      >
        {pct}
        <span className="text-[16px] font-semibold opacity-85">%</span>
      </div>
      {isPeak && (
        <div className="absolute bottom-1 right-1.5 rounded bg-black/35 px-1 text-[8.5px] font-bold uppercase tracking-wider text-white">
          peak
        </div>
      )}
      {isBookend && (
        <div className="absolute bottom-1 left-1.5 rounded bg-black/25 px-1 text-[8px] font-bold uppercase tracking-wider text-white">
          fringe
        </div>
      )}
    </div>
  );
}

function UnitDayTile({
  pct,
  used,
  cap,
  dayLabel,
  isBookend,
  kind,
}: {
  pct: number;
  used: number;
  cap: number;
  dayLabel: string;
  isBookend: boolean;
  kind: Kind;
}) {
  const s = statusOf(pct);
  const over = pct > 100;
  return (
    <div
      className={cn(
        "relative flex h-14 flex-col items-center justify-center rounded-lg border-2",
        isBookend && "opacity-65",
      )}
      style={{
        backgroundColor: s.solid,
        borderColor: s.solid,
        backgroundImage: over
          ? "repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.30) 4px, rgba(255,255,255,0.30) 8px)"
          : undefined,
      }}
      title={`${dayLabel}: ${pct}% (${used}${kind === "mixer" ? "L" : ""} of ${cap}${kind === "mixer" ? "L" : ""})`}
    >
      <div
        className={cn(
          "absolute top-1 left-1.5 text-[9px] font-bold uppercase tracking-wide text-white/85",
          isBookend && "italic",
        )}
      >
        {dayLabel}
      </div>
      <div
        className="text-[18px] font-bold leading-none tabular-nums text-white"
        style={{ textShadow: "0 1px 2px rgba(0,0,0,0.18)" }}
      >
        {pct}
        <span className="text-[10px] font-semibold opacity-85">%</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Drill-down per-unit list

function MemberBreakdown({
  group,
  dates,
  dateLabels,
  bookendDates,
  batches,
}: {
  group: GroupRow;
  dates: string[];
  dateLabels: string[];
  bookendDates: Set<string>;
  batches: Batch[];
}) {
  const rows = useMemo(() => {
    const r = group.members.map((m) => {
      const daily = unitDailyPcts(m, group, dates, batches);
      const coreIdx = dates
        .map((d, i) => (bookendDates.has(d) ? -1 : i))
        .filter((i) => i >= 0);
      const corePcts = coreIdx.map((i) => daily[i]?.pct ?? 0);
      const peak = corePcts.length > 0 ? Math.max(...corePcts) : 0;
      const overDays = daily.filter((x) => x.pct > 100).length;
      return { m, daily, peak, overDays };
    });
    return r.sort((a, b) => {
      if (b.overDays !== a.overDays) return b.overDays - a.overDays;
      return b.peak - a.peak;
    });
  }, [group, dates, bookendDates, batches]);

  return (
    <div className="border-t-2 bg-muted/40 px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          Individual units
        </span>
        <span className="text-[11px] text-muted-foreground">
          {group.members.length} {group.kind === "mixer" ? "mixers" : "dispersers"} in {group.name}
          {group.kind === "disp" && <> · sharing {group.capPerDay}-slot group cap</>}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div
            key={r.m.id}
            className="grid grid-cols-[180px_1fr_72px] items-center gap-4 rounded-lg bg-card px-3 py-2 ring-1 ring-inset ring-border"
          >
            <div className="min-w-0">
              <div className="truncate font-mono text-[12.5px] font-bold">
                {r.m.resourceCode}
              </div>
              <div className="text-[10.5px] text-muted-foreground tabular-nums">
                {group.kind === "mixer"
                  ? <>cap {fmtL(r.m.maxCapacity ?? 0)}L/day</>
                  : <>shares {group.capPerDay} slots</>}
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {r.daily.map((x, i) => (
                <UnitDayTile
                  key={i}
                  pct={x.pct}
                  used={x.used}
                  cap={x.cap}
                  dayLabel={dateLabels[i] ?? ""}
                  isBookend={group.isBookend[i] ?? false}
                  kind={group.kind}
                />
              ))}
            </div>
            <div className="text-right">
              <div
                className={cn(
                  "text-[18px] font-bold tabular-nums leading-none",
                  r.peak > 100 ? "text-red-600 dark:text-red-400" : "text-foreground",
                )}
              >
                {r.peak}%
              </div>
              <div className="mt-0.5 text-[9.5px] uppercase tracking-wider text-muted-foreground">
                peak
              </div>
              {r.overDays > 0 && (
                <div className="mt-1 inline-block rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                  {r.overDays} over
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Group row

function GroupRowView({
  g,
  dates,
  dateLabels,
  bookendDates,
  open,
  onToggle,
  batches,
}: {
  g: GroupRow;
  dates: string[];
  dateLabels: string[];
  bookendDates: Set<string>;
  open: boolean;
  onToggle: () => void;
  batches: Batch[];
}) {
  // Aggregates on CORE days only — quiet Sat shouldn't dilute a real Wed bottleneck.
  const corePcts = g.pctByDay.filter((_, i) => !g.isBookend[i]);
  const peak = corePcts.length > 0 ? Math.max(...corePcts) : 0;
  const peakIdx = g.pctByDay.indexOf(peak);
  const avg = corePcts.length > 0 ? Math.round(corePcts.reduce((a, b) => a + b, 0) / corePcts.length) : 0;
  const overDays = g.pctByDay.filter((p) => p > 100).length;

  return (
    <div>
      <button
        onClick={onToggle}
        className={cn(
          "grid w-full grid-cols-[220px_1fr_28px] items-center gap-5 px-5 py-4 text-left transition-colors",
          open ? "bg-muted/50" : "hover:bg-muted/30",
        )}
      >
        <div className="min-w-0">
          <h4 className="truncate text-[16px] font-bold tracking-tight">{g.name}</h4>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {g.members.length} {g.kind === "mixer" ? "mixers" : "dispersers"} ·{" "}
            {g.kind === "mixer" ? `${fmtL(g.capPerDay)}L/day` : `${g.capPerDay} slots/day`}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <div
              className={cn(
                "rounded px-2 py-0.5 text-[11px] font-bold",
                overDays > 0 ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400" : "bg-muted text-muted-foreground",
              )}
            >
              Avg {avg}%
            </div>
            {overDays > 0 && (
              <div className="rounded bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white">
                {overDays} OVER
              </div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-7 gap-2">
          {g.pctByDay.map((p, i) => (
            <GroupDayTile
              key={i}
              pct={p}
              dayLabel={dateLabels[i] ?? ""}
              isPeak={i === peakIdx && !(g.isBookend[i] ?? false)}
              isBookend={g.isBookend[i] ?? false}
            />
          ))}
        </div>
        <div className="flex flex-col items-center gap-0.5 text-muted-foreground">
          <ChevronRight className={cn("h-5 w-5 transition-transform", open && "rotate-90")} />
          <span className="text-[8.5px] uppercase tracking-wide">{open ? "hide" : "units"}</span>
        </div>
      </button>
      {open && (
        <MemberBreakdown
          group={g}
          dates={dates}
          dateLabels={dateLabels}
          bookendDates={bookendDates}
          batches={batches}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Top-level component

export function CapacityOverviewWall({
  batches,
  resources,
  dates,
  bookendDates,
  kind = "all",
}: CapacityOverviewWallProps) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const onToggle = useCallback(
    (k: string) => setOpenKey((cur) => (cur === k ? null : k)),
    [],
  );

  const mixerGroups = useMemo(
    () => buildMixerGroups(batches, resources, dates, bookendDates),
    [batches, resources, dates, bookendDates],
  );
  const dispGroups = useMemo(
    () => buildDispGroups(batches, resources, dates, bookendDates),
    [batches, resources, dates, bookendDates],
  );

  const sortFn = (a: GroupRow, b: GroupRow) => {
    const core = (g: GroupRow) => g.pctByDay.filter((_, i) => !g.isBookend[i]);
    const ao = core(a).filter((p) => p > 100).length;
    const bo = core(b).filter((p) => p > 100).length;
    if (ao !== bo) return bo - ao;
    return Math.max(0, ...core(b)) - Math.max(0, ...core(a));
  };

  const mixers = mixerGroups.slice().sort(sortFn);
  const disps = dispGroups.slice().sort(sortFn);

  const dateLabels = dates.map((d) => format(new Date(d + "T12:00:00"), "EEE d"));

  const renderBlock = (title: string, sub: string, groups: GroupRow[]) => {
    if (groups.length === 0) return null;
    return (
      <section className="rounded-lg border bg-card">
        <div className="border-b px-5 py-3">
          <div className="text-sm font-semibold uppercase tracking-wide">{title}</div>
          <div className="text-[11.5px] text-muted-foreground">{sub}</div>
        </div>
        <div className="divide-y">
          {groups.map((g) => (
            <GroupRowView
              key={g.key}
              g={g}
              dates={dates}
              dateLabels={dateLabels}
              bookendDates={bookendDates}
              open={openKey === g.key}
              onToggle={() => onToggle(g.key)}
              batches={batches}
            />
          ))}
        </div>
      </section>
    );
  };

  return (
    <div className="space-y-4">
      {kind !== "disp" && renderBlock(
        "Mixer capacity",
        "One row per trunk · seven tiles per group · click any row for individual units.",
        mixers,
      )}
      {kind !== "mixer" && renderBlock(
        "Disperser capacity",
        "Shared group capacity · one row per group · click any row for individual units.",
        disps,
      )}
    </div>
  );
}
