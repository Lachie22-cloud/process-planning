import { useMemo, useState } from "react";
import { format, eachDayOfInterval } from "date-fns";
import { Download, BarChart3, Table as TableIcon } from "lucide-react";
import { useLinkedFillOrders } from "@/hooks/use-linked-fill-orders";
import { Skeleton } from "@/components/ui/skeleton";
import { parsePackSizeLitres } from "@/lib/utils/pack-size";
import { exportToCsv } from "@/lib/utils/export-csv";
import type { Batch } from "@/types/batch";

// Deterministic colour per litre value — stable across weeks
const PACK_COLOURS: Record<number, string> = {
  0.5: "#a855f7",
  1: "#3b82f6",
  2: "#34d399",
  2.5: "#4ade80",
  4: "#10b981",
  5: "#fb923c",
  10: "#f59e0b",
  15: "#f97316",
  20: "#ef4444",
  200: "#64748b",
};
const FALLBACK_COLOURS = ["#8b5cf6", "#06b6d4", "#84cc16", "#f43f5e", "#14b8a6", "#e879f9"];

function colourForLitres(litres: number | null, index: number): string {
  if (litres !== null && PACK_COLOURS[litres]) return PACK_COLOURS[litres];
  return FALLBACK_COLOURS[index % FALLBACK_COLOURS.length] ?? '#a3a3a3';
}

function formatPackSizeLabel(raw: string): string {
  const litres = parsePackSizeLitres(raw);
  if (litres === null) return raw;
  if (litres < 1) return `${Math.round(litres * 1000)} mL`;
  const isWhole = litres % 1 === 0;
  return `${isWhole ? String(litres | 0) : String(litres)} L`;
}

interface SizeRow {
  sizeKey: string;
  sizeLabel: string;
  litres: number | null;
  color: string;
  days: Record<string, { qty: number; pct: number }>;
  rowTotal: number;
  rowPct: number;
}

// ── Table view ──────────────────────────────────────────────────────────────

function PackSwatch({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]"
      style={{ backgroundColor: color }}
    />
  );
}

function FGTable({
  rows,
  weekDays,
  dayKeys,
  colTotals,
  grandTotal,
}: {
  rows: SizeRow[];
  weekDays: Date[];
  dayKeys: string[];
  colTotals: number[];
  grandTotal: number;
}) {
  const maxCell = Math.max(...rows.flatMap((r) => dayKeys.map((k) => r.days[k]?.qty ?? 0)), 1);

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-[11.5px] min-w-[820px]">
        <thead>
          <tr className="bg-muted/80 text-[10.5px] uppercase tracking-wide">
            <th className="sticky left-0 z-10 py-2 pl-4 pr-3 text-left font-medium text-foreground bg-muted/80 min-w-[130px]">
              Pack size
            </th>
            {weekDays.map((day, i) => (
              <th key={dayKeys[i]} className="px-2 py-2 text-center font-medium text-foreground min-w-[110px]">
                <div className="font-semibold">{format(day, "EEE")}</div>
                <div className="text-muted-foreground font-normal normal-case tracking-normal">
                  {format(day, "d MMM")}
                </div>
              </th>
            ))}
            <th className="pl-2 pr-4 py-2 text-right font-medium text-foreground min-w-[110px]">
              Week total
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((r, idx) => (
            <tr
              key={r.sizeKey}
              className={`border-t border-border transition hover:bg-muted/50 ${
                idx % 2 ? "bg-muted/40" : "bg-card"
              }`}
            >
              <td
                className={`sticky left-0 z-10 py-2 pl-4 pr-3 align-middle ${
                  idx % 2 ? "bg-muted/40" : "bg-card"
                }`}
              >
                <div className="flex items-center gap-2">
                  <PackSwatch color={r.color} />
                  <span className="text-[12px] font-semibold text-foreground tabular-nums">
                    {r.sizeLabel}
                  </span>
                </div>
              </td>
              {dayKeys.map((key) => {
                const cell = r.days[key];
                const qty = cell?.qty ?? 0;
                const pct = Math.round((cell?.pct ?? 0) * 100);
                const intensity = qty / maxCell;
                return (
                  <td key={key} className="px-2 py-2 align-middle">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[12px] font-semibold text-foreground tabular-nums">
                          {qty ? (
                            qty.toLocaleString()
                          ) : (
                            <span className="text-muted-foreground/40">–</span>
                          )}
                        </span>
                        {qty > 0 && (
                          <span className="text-[10.5px] text-muted-foreground tabular-nums">
                            {pct}%
                          </span>
                        )}
                      </div>
                      <div className="h-[5px] w-[40px] overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, intensity * 100)}%`,
                            backgroundColor: r.color,
                            opacity: 0.9,
                          }}
                        />
                      </div>
                    </div>
                  </td>
                );
              })}
              <td className="pl-2 pr-4 py-2 align-middle text-right">
                <div className="text-[12px] font-semibold text-foreground tabular-nums">
                  {r.rowTotal.toLocaleString()}
                </div>
                <div className="text-[10.5px] text-muted-foreground tabular-nums">
                  {Math.round(r.rowPct * 100)}%
                </div>
              </td>
            </tr>
          ))}
        </tbody>

        <tfoot>
          <tr className="bg-muted/80 text-foreground">
            <td className="sticky left-0 z-10 py-2 pl-4 pr-3 text-[11px] font-semibold uppercase tracking-wide bg-muted/80">
              Day total
            </td>
            {colTotals.map((t, i) => (
              <td key={dayKeys[i]} className="px-2 py-2 text-center">
                <div className="text-[12px] font-semibold tabular-nums">{t.toLocaleString()}</div>
                {grandTotal > 0 && (
                  <div className="text-[10.5px] text-muted-foreground tabular-nums">
                    {Math.round((t / grandTotal) * 100)}%
                  </div>
                )}
              </td>
            ))}
            <td className="pl-2 pr-4 py-2 text-right">
              <div className="text-[13px] font-semibold tabular-nums">{grandTotal.toLocaleString()}</div>
              <div className="text-[10.5px] text-muted-foreground tabular-nums">100%</div>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Stacked bar chart (pure CSS) ────────────────────────────────────────────

function FGStackedChart({
  rows,
  weekDays,
  dayKeys,
  colTotals,
}: {
  rows: SizeRow[];
  weekDays: Date[];
  dayKeys: string[];
  colTotals: number[];
}) {
  const maxCol = Math.max(...colTotals, 1);
  const H = 260;

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-end gap-4 px-2" style={{ height: H + 36 }}>
        {weekDays.map((day, i) => {
          const dayKey = dayKeys[i] ?? "";
          const colTotal = colTotals[i] ?? 0;
          const h = (colTotal / maxCol) * H;

          return (
            <div key={dayKey} className="flex-1 flex flex-col items-center gap-2 min-w-0">
              <div className="relative w-full max-w-[96px]" style={{ height: H }}>
                {colTotal > 0 && (
                  <div
                    className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full rounded-md overflow-hidden"
                    style={{ height: h }}
                  >
                    {rows.map((r) => {
                      const qty = r.days[dayKey]?.qty ?? 0;
                      if (!qty) return null;
                      const segH = (qty / colTotal) * h;
                      const pct = Math.round((qty / colTotal) * 100);
                      return (
                        <div
                          key={r.sizeKey}
                          className="w-full relative flex items-center justify-center text-[10px] font-semibold text-white"
                          style={{ height: segH, backgroundColor: r.color }}
                          title={`${r.sizeLabel}: ${qty.toLocaleString()} (${pct}%)`}
                        >
                          {pct >= 12 && (
                            <span className="tabular-nums drop-shadow-sm">{pct}%</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {colTotal > 0 && (
                  <div
                    className="absolute left-1/2 -translate-x-1/2 text-[10.5px] font-semibold text-foreground tabular-nums whitespace-nowrap"
                    style={{ bottom: h + 4 }}
                  >
                    {colTotal.toLocaleString()}
                  </div>
                )}
              </div>
              <div className="text-center">
                <div className="text-[11.5px] font-semibold text-foreground">
                  {format(day, "EEE")}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {format(day, "d MMM")}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Legend ───────────────────────────────────────────────────────────────────

function FGLegend({ rows }: { rows: SizeRow[] }) {
  return (
    <div className="flex flex-wrap items-center gap-3 pt-3">
      {rows.map((r) => (
        <span
          key={r.sizeKey}
          className="inline-flex items-center gap-1.5 text-[11px] text-foreground"
        >
          <PackSwatch color={r.color} />
          <span className="tabular-nums font-medium">{r.sizeLabel}</span>
          <span className="text-muted-foreground tabular-nums">
            {r.rowTotal.toLocaleString()}
          </span>
        </span>
      ))}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface FinishedGoodSizeReportProps {
  batches: Batch[];
  weekStart: Date;
  weekEnding: Date;
}

export function FinishedGoodSizeReport({
  batches,
  weekStart,
  weekEnding,
}: FinishedGoodSizeReportProps) {
  const [view, setView] = useState<"table" | "chart">("table");

  const batchIds = useMemo(() => batches.map((b) => b.id), [batches]);
  const { data: fillOrders = [], isLoading } = useLinkedFillOrders(batchIds);

  // Mon–Sat (exclude Sunday) for the selected week
  const weekDays = useMemo(
    () => eachDayOfInterval({ start: weekStart, end: weekEnding }),
    [weekStart, weekEnding],
  );
  const dayKeys = useMemo(() => weekDays.map((d) => format(d, "yyyy-MM-dd")), [weekDays]);

  // Build batch → planDate lookup
  const batchDateMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of batches) {
      if (b.planDate) m.set(b.id, b.planDate);
    }
    return m;
  }, [batches]);

  // Pivot: (sizeKey, dayKey) → qty
  const { rows, colTotals, grandTotal } = useMemo(() => {
    const pivot = new Map<string, Map<string, number>>();

    for (const fo of fillOrders) {
      if (!fo.packSize) continue;
      const dayKey = batchDateMap.get(fo.batchId);
      if (!dayKey) continue;
      const qty = fo.quantity ?? 0;
      if (qty === 0) continue;

      const sizeKey = fo.packSize;
      if (!pivot.has(sizeKey)) pivot.set(sizeKey, new Map());
      const dayMap = pivot.get(sizeKey)!;
      dayMap.set(dayKey, (dayMap.get(dayKey) ?? 0) + qty);
    }

    // Build sorted rows (smallest → largest litres; nulls last)
    const sizeKeys = Array.from(pivot.keys());
    sizeKeys.sort((a, b) => {
      const aL = parsePackSizeLitres(a) ?? Infinity;
      const bL = parsePackSizeLitres(b) ?? Infinity;
      return aL - bL;
    });

    // Column totals (across all sizes per day)
    const colTotalsArr = dayKeys.map((dk) =>
      sizeKeys.reduce((s, sk) => s + (pivot.get(sk)?.get(dk) ?? 0), 0),
    );
    const total = colTotalsArr.reduce((s, t) => s + t, 0);

    const builtRows: SizeRow[] = sizeKeys.map((sk, idx) => {
      const litres = parsePackSizeLitres(sk);
      const color = colourForLitres(litres, idx);
      const dayMap = pivot.get(sk)!;
      const rowTotal = Array.from(dayMap.values()).reduce((s, v) => s + v, 0);

      const days: Record<string, { qty: number; pct: number }> = {};
      for (const dk of dayKeys) {
        const qty = dayMap.get(dk) ?? 0;
        const colTotal = colTotalsArr[dayKeys.indexOf(dk)] ?? 0;
        days[dk] = { qty, pct: colTotal > 0 ? qty / colTotal : 0 };
      }

      return {
        sizeKey: sk,
        sizeLabel: formatPackSizeLabel(sk),
        litres,
        color,
        days,
        rowTotal,
        rowPct: total > 0 ? rowTotal / total : 0,
      };
    });

    return { rows: builtRows, colTotals: colTotalsArr, grandTotal: total };
  }, [fillOrders, batchDateMap, dayKeys]);

  function handleExport() {
    if (rows.length === 0) return;
    const csvRows = rows.map((r) => {
      const dayEntries = Object.fromEntries(
        weekDays.map((d, i) => [
          format(d, "EEE d MMM"),
          r.days[dayKeys[i] ?? ""]?.qty ?? 0,
        ]),
      );
      return { "Pack Size": r.sizeLabel, ...dayEntries, "Week Total": r.rowTotal };
    });
    // Add totals row
    const totalsEntry = Object.fromEntries(
      weekDays.map((d, i) => [format(d, "EEE d MMM"), colTotals[i] ?? 0]),
    );
    csvRows.push({ "Pack Size": "TOTAL", ...totalsEntry, "Week Total": grandTotal } as typeof csvRows[0]);
    exportToCsv(`fg-size-report-${format(weekStart, "yyyy-MM-dd")}.csv`, csvRows);
  }

  return (
    <section className="rounded-xl border border-border bg-card shadow-[0_1px_3px_rgb(0_0_0_/_0.04),_0_4px_12px_-4px_rgb(0_0_0_/_0.04)]">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <p className="text-[10.5px] font-mono uppercase tracking-wider text-muted-foreground">
            Production mix · this week
          </p>
          <h3 className="text-[14px] font-semibold tracking-tight text-foreground">
            Finished Good Size Report
          </h3>
          <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
            Units scheduled by pack size and day. Rows appear only for pack sizes scheduled this
            week.
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {/* Table / Chart toggle */}
          <div className="inline-flex rounded-md bg-muted p-0.5">
            {(
              [
                { value: "table", label: "Table", Icon: TableIcon },
                { value: "chart", label: "Chart", Icon: BarChart3 },
              ] as const
            ).map(({ value, label, Icon }) => (
              <button
                key={value}
                onClick={() => setView(value)}
                className={`inline-flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium transition ${
                  view === value
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          <button
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] font-medium transition bg-card text-foreground ring-1 ring-inset ring-border hover:bg-muted/60"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 pb-5">
        {isLoading ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-border py-12 text-center text-[12px] text-muted-foreground">
            No fill orders scheduled this week.
          </div>
        ) : (
          <>
            {view === "table" ? (
              <FGTable
                rows={rows}
                weekDays={weekDays}
                dayKeys={dayKeys}
                colTotals={colTotals}
                grandTotal={grandTotal}
              />
            ) : (
              <FGStackedChart
                rows={rows}
                weekDays={weekDays}
                dayKeys={dayKeys}
                colTotals={colTotals}
              />
            )}
            <FGLegend rows={rows} />
          </>
        )}
      </div>
    </section>
  );
}
