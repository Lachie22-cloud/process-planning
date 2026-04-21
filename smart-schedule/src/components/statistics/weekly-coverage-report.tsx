import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  AlertOctagon,
  AlertTriangle,
  Clock,
  CheckCircle,
  ChevronRight,
  Download,
} from "lucide-react";
import { useBatchesCoverage } from "@/hooks/use-batch-coverage";
import { useLinkedFillOrders } from "@/hooks/use-linked-fill-orders";
import { useResources } from "@/hooks/use-resources";
import { Skeleton } from "@/components/ui/skeleton";
import { exportToCsv } from "@/lib/utils/export-csv";
import type { Batch, BatchCoverageItem, CoverageLevel, LinkedFillOrder } from "@/types/batch";
import type { Resource } from "@/types/resource";

// Trunk dot colours matching the design system
const TRUNK_COLORS: Record<string, string> = {
  TK1: "#3B82F6",
  TK2: "#10B981",
  TK3: "#F59E0B",
  TK4: "#EF4444",
  TK5: "#8B5CF6",
  TK6: "#EC4899",
  THINNERS: "#64748b",
};

const SECTION_CONFIG = {
  "Stock Out": {
    key: "oos" as const,
    label: "Out of Stock",
    desc: "Material shortfall blocking fill",
    threshold: "0 days",
    barClass: "bg-rose-500",
    pillBg: "bg-rose-50 dark:bg-rose-950/40",
    pillText: "text-rose-700 dark:text-rose-300",
    pillRing: "ring-rose-200 dark:ring-rose-900/60",
    accent: "#e11d48",
    Icon: AlertOctagon,
  },
  Critical: {
    key: "critical" as const,
    label: "Critical",
    desc: "Less than 15 days of forward coverage",
    threshold: "< 15 days",
    barClass: "bg-orange-500",
    pillBg: "bg-orange-50 dark:bg-orange-950/40",
    pillText: "text-orange-700 dark:text-orange-300",
    pillRing: "ring-orange-200 dark:ring-orange-900/60",
    accent: "#f97316",
    Icon: AlertTriangle,
  },
  Low: {
    key: "low" as const,
    label: "Low",
    desc: "Less than 30 days of forward coverage",
    threshold: "< 30 days",
    barClass: "bg-amber-500",
    pillBg: "bg-amber-50 dark:bg-amber-950/40",
    pillText: "text-amber-700 dark:text-amber-300",
    pillRing: "ring-amber-200 dark:ring-amber-900/60",
    accent: "#f59e0b",
    Icon: Clock,
  },
} satisfies Record<string, unknown>;

interface AtRiskRow {
  batch: Batch;
  level: CoverageLevel;
  worstItem: BatchCoverageItem;
  resource: Resource | null;
  totalQty: number;
  fillOrderNums: string;
}

function TrunkChip({ trunk }: { trunk: string }) {
  const color = TRUNK_COLORS[trunk] ?? "#64748b";
  return (
    <span className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums ring-1 ring-inset ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-800">
      <span className="h-1.5 w-1.5 rounded-sm" style={{ backgroundColor: color }} />
      {trunk}
    </span>
  );
}

function CoverageRow({
  row,
  accent,
}: {
  row: AtRiskRow;
  accent: string;
}) {
  const maxCap = 30;
  const pct = Math.min(100, Math.max(3, (row.worstItem.stockCover / maxCap) * 100));
  const trunkLine = row.resource?.trunkLine;
  const mixerLabel = row.resource?.displayName ?? row.resource?.resourceCode ?? "—";

  return (
    <tr className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40">
      {/* Batch */}
      <td className="py-2 pl-4 pr-3 align-middle">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {row.batch.sapOrder}
          </span>
          <span className="font-mono text-[10.5px] text-slate-400 dark:text-slate-500">
            {row.batch.bulkCode ?? row.batch.materialCode}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[260px]">
          {row.batch.materialDescription ?? row.batch.materialCode ?? "—"}
        </p>
      </td>

      {/* Shade (materialCode) */}
      <td className="px-3 align-middle">
        <span className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300">
          {row.batch.materialCode ?? "—"}
        </span>
      </td>

      {/* Trunk · Mixer */}
      <td className="px-3 align-middle">
        <div className="flex items-center gap-1.5">
          {trunkLine ? <TrunkChip trunk={trunkLine} /> : null}
          <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            {mixerLabel}
          </span>
        </div>
      </td>

      {/* Qty · Pack */}
      <td className="px-3 align-middle text-right">
        <div className="text-[12px] font-semibold tabular-nums text-slate-900 dark:text-slate-100">
          {row.totalQty > 0 ? row.totalQty.toLocaleString() : "—"}
        </div>
        <div className="text-[10.5px] text-slate-500 dark:text-slate-400">
          {row.batch.packSizeSummary ?? "—"}
        </div>
      </td>

      {/* Worst-coverage material + bar */}
      <td className="px-3 align-middle">
        <div className="flex items-center gap-3 min-w-[240px]">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300 truncate">
              {row.worstItem.material ?? row.worstItem.planningMaterial}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, backgroundColor: accent }}
                />
              </div>
              <span
                className="w-[58px] text-right text-[11px] font-semibold tabular-nums"
                style={{ color: accent }}
              >
                {row.worstItem.stockCover === 0 ? "OUT" : `${row.worstItem.stockCover}d left`}
              </span>
            </div>
          </div>
        </div>
      </td>

      {/* Fill order(s) */}
      <td className="pl-3 pr-4 align-middle">
        <span className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 tabular-nums">
          {row.fillOrderNums || "—"}
        </span>
      </td>
    </tr>
  );
}

function CoverageSection({
  level,
  rows,
  open,
  onToggle,
}: {
  level: "Stock Out" | "Critical" | "Low";
  rows: AtRiskRow[];
  open: boolean;
  onToggle: () => void;
}) {
  const cfg = SECTION_CONFIG[level];
  const { Icon } = cfg;
  const trunks = [...new Set(rows.flatMap((r) => r.resource?.trunkLine ? [r.resource.trunkLine] : []))].slice(0, 4);

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 py-3 pl-3 pr-4 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
      >
        {/* Severity spine */}
        <span className={`h-8 w-1 rounded-full shrink-0 ${cfg.barClass}`} />

        {/* Chevron */}
        <span
          className={`inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 transition shrink-0 ${open ? "rotate-90" : ""}`}
        >
          <ChevronRight className="h-4 w-4" />
        </span>

        {/* Count pill */}
        <span
          className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset shrink-0 ${cfg.pillBg} ${cfg.pillText} ${cfg.pillRing}`}
        >
          <Icon className="h-3.5 w-3.5" />
          {rows.length}
        </span>

        {/* Label + desc */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">
              {cfg.label}
            </span>
            <span className="font-mono text-[10.5px] text-slate-400 dark:text-slate-500">
              {cfg.threshold}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{cfg.desc}</p>
        </div>

        {/* Trunk chips summary */}
        {trunks.length > 0 && (
          <div className="hidden md:flex items-center gap-1.5 shrink-0">
            {trunks.map((t) => (
              <TrunkChip key={t} trunk={t} />
            ))}
          </div>
        )}
      </button>

      {open && rows.length > 0 && (
        <div className="border-t border-slate-100 dark:border-slate-800 overflow-x-auto">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="bg-slate-900 dark:bg-slate-950 text-[10.5px] uppercase tracking-wide">
                <th className="py-2 pl-4 pr-3 text-left font-medium text-white">Batch</th>
                <th className="px-3 text-left font-medium text-white">Shade</th>
                <th className="px-3 text-left font-medium text-white">Trunk · Mixer</th>
                <th className="px-3 text-right font-medium text-white">Qty · Pack</th>
                <th className="px-3 text-left font-medium text-white">Worst-coverage material</th>
                <th className="pl-3 pr-4 text-left font-medium text-white">Order</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <CoverageRow key={row.batch.id} row={row} accent={cfg.accent} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AllClearState() {
  return (
    <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/30 px-5 py-4 flex items-center gap-4">
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300">
        <CheckCircle className="h-5 w-5" />
      </span>
      <div className="flex-1">
        <p className="text-[13px] font-semibold text-emerald-800 dark:text-emerald-200">
          All batches have healthy coverage
        </p>
        <p className="text-[11.5px] text-emerald-700/80 dark:text-emerald-300/80">
          No batches scheduled this week fall below 30 days of forward material coverage.
        </p>
      </div>
      <span className="hidden md:inline-flex items-center gap-1.5 rounded-md bg-emerald-100 dark:bg-emerald-900/60 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:text-emerald-200 ring-1 ring-inset ring-emerald-200 dark:ring-emerald-900">
        0 at risk
      </span>
    </div>
  );
}

interface WeeklyCoverageReportProps {
  batches: Batch[];
}

export function WeeklyCoverageReport({ batches }: WeeklyCoverageReportProps) {
  const batchIds = useMemo(() => batches.map((b) => b.id), [batches]);

  const { data: coverageMap = new Map<string, BatchCoverageItem[]>(), isLoading: covLoading } =
    useBatchesCoverage(batchIds);
  const { data: fillOrders = [], isLoading: foLoading } = useLinkedFillOrders(batchIds);
  const { data: resources = [] } = useResources();

  const resourceMap = useMemo(() => {
    const m = new Map<string, Resource>();
    for (const r of resources) m.set(r.id, r);
    return m;
  }, [resources]);

  const fillOrdersByBatch = useMemo(() => {
    const m = new Map<string, LinkedFillOrder[]>();
    for (const fo of fillOrders) {
      const arr = m.get(fo.batchId) ?? [];
      arr.push(fo);
      m.set(fo.batchId, arr);
    }
    return m;
  }, [fillOrders]);

  // Build at-risk rows
  const atRiskRows = useMemo<AtRiskRow[]>(() => {
    return batches.flatMap((batch) => {
      const items = coverageMap.get(batch.id);
      if (!items || items.length === 0) return [];
      const worst = items[0];
      if (!worst || worst.level === "Good") return [];

      const resource = batch.planResourceId ? resourceMap.get(batch.planResourceId) ?? null : null;
      const batchFOs = fillOrdersByBatch.get(batch.id) ?? [];
      const totalQty = batchFOs.reduce((s, fo) => s + (fo.quantity ?? 0), 0);
      const fillOrderNums = [
        ...new Set(batchFOs.map((fo) => fo.fillOrder).filter(Boolean) as string[]),
      ].join(", ");

      return [{ batch, level: worst.level, worstItem: worst, resource, totalQty, fillOrderNums }];
    });
  }, [batches, coverageMap, fillOrdersByBatch, resourceMap]);

  const sections = useMemo(() => {
    const byLevel = new Map<CoverageLevel, AtRiskRow[]>();
    for (const row of atRiskRows) {
      const arr = byLevel.get(row.level) ?? [];
      arr.push(row);
      byLevel.set(row.level, arr);
    }
    // Sort within each section by planDate then sapOrder
    for (const [, rows] of byLevel) {
      rows.sort((a, b) => {
        const dateCompare = (a.batch.planDate ?? "").localeCompare(b.batch.planDate ?? "");
        return dateCompare !== 0 ? dateCompare : a.batch.sapOrder.localeCompare(b.batch.sapOrder);
      });
    }
    return byLevel;
  }, [atRiskRows]);

  const [openKeys, setOpenKeys] = useState<Record<string, boolean>>({
    oos: true,
    critical: true,
    low: false,
  });

  const totalAtRisk = atRiskRows.length;
  const isLoading = covLoading || foLoading;

  function handleExportCsv() {
    const rows = atRiskRows.map((r) => ({
      "Plan Date": r.batch.planDate ? format(new Date(r.batch.planDate + "T12:00:00"), "d MMM yyyy") : "",
      "SAP Order": r.batch.sapOrder,
      "Material": r.batch.materialDescription ?? r.batch.materialCode ?? "",
      "Level": r.level,
      "Trunk": r.resource?.trunkLine ?? "",
      "Mixer": r.resource?.displayName ?? r.resource?.resourceCode ?? "",
      "Qty": r.totalQty,
      "Pack Size": r.batch.packSizeSummary ?? "",
      "Worst Material": r.worstItem.material ?? r.worstItem.planningMaterial,
      "Stock Cover (days)": r.worstItem.stockCover,
      "Fill Orders": r.fillOrderNums,
    }));
    exportToCsv("coverage-report.csv", rows);
  }

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-[0_1px_3px_rgb(0_0_0_/_0.04),_0_4px_12px_-4px_rgb(0_0_0_/_0.04)]">
      {/* Card header */}
      <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <p className="text-[10.5px] font-mono uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Stock risk · this week
          </p>
          <h3 className="text-[14px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Batch Coverage Report
          </h3>
          <p className="mt-0.5 text-[11.5px] leading-snug text-slate-500 dark:text-slate-400">
            Batches scheduled this week where at least one input material's forward coverage is at
            risk. Click a section to expand.
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {!isLoading && (
            <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              <span className="font-semibold text-slate-900 dark:text-slate-100">{totalAtRisk}</span>{" "}
              at risk
            </span>
          )}
          <button
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 transition"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 pb-5 space-y-2">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : totalAtRisk === 0 ? (
          <AllClearState />
        ) : (
          (["Stock Out", "Critical", "Low"] as const).map((level) => {
            const rows = sections.get(level) ?? [];
            const cfg = SECTION_CONFIG[level];
            return (
              <CoverageSection
                key={level}
                level={level}
                rows={rows}
                open={openKeys[cfg.key] ?? false}
                onToggle={() =>
                  setOpenKeys((s) => ({ ...s, [cfg.key]: !s[cfg.key] }))
                }
              />
            );
          })
        )}
      </div>
    </section>
  );
}
