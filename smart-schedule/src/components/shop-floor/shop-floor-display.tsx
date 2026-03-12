import { useMemo } from "react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { BATCH_STATUSES } from "@/lib/constants/statuses";
import type { Batch } from "@/types/batch";
import type { Resource } from "@/types/resource";

interface ShopFloorDisplayProps {
  batches: Batch[];
  resources: Resource[];
  weekLabel: string;
  dates: string[];
}

function ShopFloorBatchCard({ batch }: { batch: Batch }) {
  const config = BATCH_STATUSES[batch.status];
  return (
    <div
      className={cn(
        "rounded border px-2 py-1 text-xs",
        config?.bgClass ?? "bg-neutral-800",
        config?.textClass ?? "text-neutral-300",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="font-semibold truncate">{batch.sapOrder}</span>
        <span className="shrink-0 font-mono text-[10px]">
          {batch.batchVolume != null ? `${batch.batchVolume.toLocaleString()}L` : ""}
        </span>
      </div>
      <div className="truncate opacity-80 text-[10px]">
        {batch.materialDescription ?? "—"}
      </div>
      {batch.status !== "Planned" && (
        <span className="mt-0.5 inline-block rounded-sm bg-white/10 px-1 py-0.5 text-[9px] font-semibold">
          {batch.status}
        </span>
      )}
    </div>
  );
}

export function ShopFloorDisplay({
  batches,
  resources,
  weekLabel,
  dates,
}: ShopFloorDisplayProps) {
  const mixers = useMemo(
    () => resources.filter((r) => r.resourceType === "mixer"),
    [resources],
  );

  const batchGrid = useMemo(() => {
    const grid = new Map<string, Batch[]>();
    for (const r of mixers) {
      for (const d of dates) {
        grid.set(`${r.id}:${d}`, []);
      }
    }
    for (const b of batches) {
      if (b.planResourceId && b.planDate) {
        const key = `${b.planResourceId}:${b.planDate}`;
        grid.get(key)?.push(b);
      }
    }
    return grid;
  }, [batches, mixers, dates]);

  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-neutral-950 p-4 text-white">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/schedule")}
            className="flex items-center gap-1.5 rounded-md bg-neutral-800 px-3 py-1.5 text-sm font-medium text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Exit Shop Floor
          </button>
          <h1 className="text-xl font-bold">Shop Floor — Mixer Schedule</h1>
        </div>
        <div className="flex items-center gap-4 text-sm text-neutral-400">
          <span>{weekLabel}</span>
          <span>
            Updated: {format(new Date(), "HH:mm")}
          </span>
        </div>
      </div>

      {/* Status legend */}
      <div className="mb-4 flex flex-wrap gap-2">
        {Object.entries(BATCH_STATUSES).map(([status, config]) => (
          <div
            key={status}
            className={cn(
              "rounded px-2 py-0.5 text-[10px] font-semibold",
              config.bgClass,
              config.textClass,
            )}
          >
            {config.label}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[900px] gap-px bg-neutral-800"
          style={{
            gridTemplateColumns: `140px repeat(${dates.length}, minmax(100px, 1fr))`,
          }}
        >
          {/* Header row */}
          <div className="bg-neutral-900 px-3 py-2 text-xs font-semibold uppercase text-neutral-500">
            Resource
          </div>
          {dates.map((dateStr) => {
            const date = new Date(dateStr + "T12:00:00");
            const isToday =
              format(new Date(), "yyyy-MM-dd") === dateStr;
            return (
              <div
                key={dateStr}
                className={cn(
                  "bg-neutral-900 px-2 py-2 text-center",
                  isToday && "bg-blue-950/50",
                )}
              >
                <div className="text-xs font-semibold text-neutral-400">
                  {format(date, "EEE")}
                </div>
                <div
                  className={cn(
                    "text-sm tabular-nums",
                    isToday && "font-bold text-blue-400",
                  )}
                >
                  {format(date, "d MMM")}
                </div>
              </div>
            );
          })}

          {/* Resource lanes */}
          {mixers.map((mixer) => (
            <div key={mixer.id} className="contents">
              {/* Label */}
              <div className="flex flex-col justify-center bg-neutral-900 px-3 py-2">
                <span className="text-sm font-semibold">
                  {mixer.displayName ?? mixer.resourceCode}
                </span>
                <span className="text-[10px] text-neutral-500">
                  {mixer.trunkLine && `T${mixer.trunkLine}`}
                  {mixer.maxCapacity != null && ` · ${mixer.maxCapacity.toLocaleString()}L`}
                </span>
              </div>

              {/* Day cells */}
              {dates.map((date) => {
                const dayBatches = batchGrid.get(`${mixer.id}:${date}`) ?? [];
                const isToday =
                  format(new Date(), "yyyy-MM-dd") === date;
                return (
                  <div
                    key={date}
                    className={cn(
                      "flex min-h-[70px] flex-col gap-1 bg-neutral-900/50 p-1",
                      isToday && "bg-blue-950/20",
                    )}
                  >
                    {dayBatches.map((batch) => (
                      <ShopFloorBatchCard key={batch.id} batch={batch} />
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
