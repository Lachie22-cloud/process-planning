import { useState, useMemo, useEffect } from "react";
import { cn } from "@/lib/ui/cn";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TRUNK_COLORS } from "./trunk-card";
import type { FillingJob, FoAssignments, TrunkJob } from "./types";
import type { LinkedFillOrder } from "@/types/batch";

const TRUNK_ORDER = ["TK1", "TK2", "TK3", "TK4", "TK5", "TK6"];

interface PackSizeDistributionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: FillingJob | null;
  /** All enriched jobs — used to compute load bars */
  allJobs: TrunkJob[];
  currentAssignments: FoAssignments;
  trunkLeaders?: Record<string, string>;
  onApply: (
    batchId: string,
    assignments: Array<{ trunkLine: string; fillOrderIds: string[] }>,
  ) => void;
}

function packLabel(fo: LinkedFillOrder): string {
  if (fo.quantity && fo.packSize) return `${fo.quantity} × ${fo.packSize}`;
  if (fo.packSize) return fo.packSize;
  return fo.fillOrder ?? "—";
}

function trunkLoad(trunkId: string, jobs: TrunkJob[]): number {
  return jobs.filter(
    (j) =>
      (j.sourceTrunkLine ?? j.resource?.trunkLine) === trunkId ||
      (j.displayFOs?.length && j.isReceived),
  ).length;
}

export function PackSizeDistributionModal({
  open,
  onOpenChange,
  job,
  allJobs,
  currentAssignments,
  trunkLeaders = {},
  onApply,
}: PackSizeDistributionModalProps) {
  // Local state: fillOrderId → trunkLine
  const [local, setLocal] = useState<FoAssignments>({});

  // Initialize from currentAssignments when job changes
  useEffect(() => {
    if (!job) return;
    const init: FoAssignments = {};
    const homeTrunk = job.resource?.trunkLine;
    for (const fo of job.linkedFillOrders) {
      init[fo.id] = currentAssignments[fo.id] ?? homeTrunk ?? "";
    }
    setLocal(init);
  }, [job, currentAssignments]);

  const foList = useMemo(
    () => job?.linkedFillOrders.filter((fo) => fo.packSize || fo.quantity) ?? [],
    [job],
  );

  function handleAssign(foId: string, trunkLine: string) {
    setLocal((prev) => ({ ...prev, [foId]: trunkLine }));
  }

  function handleApply() {
    if (!job) return;
    // Group by trunkLine
    const groups: Record<string, string[]> = {};
    for (const [foId, trunk] of Object.entries(local)) {
      if (!trunk) continue;
      groups[trunk] = [...(groups[trunk] ?? []), foId];
    }
    onApply(
      job.id,
      Object.entries(groups).map(([trunkLine, fillOrderIds]) => ({
        trunkLine,
        fillOrderIds,
      })),
    );
  }

  if (!job) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[15px]">
            Route pack sizes —{" "}
            <span className="font-mono text-muted-foreground">{job.materialCode ?? job.sapOrder}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* Trunk load summary */}
          <div className="grid grid-cols-6 gap-1.5">
            {TRUNK_ORDER.map((t) => {
              const color = TRUNK_COLORS[t] ?? "#9ca3af";
              const load = trunkLoad(t, allJobs);
              const badgeLabel = t.replace("TK", "T");
              return (
                <div key={t} className="flex flex-col items-center gap-1">
                  <div
                    className="grid w-full place-items-center rounded-[5px] py-1 text-[11px] font-bold text-white"
                    style={{ backgroundColor: color }}
                  >
                    {badgeLabel}
                  </div>
                  <span className="text-[9.5px] text-muted-foreground tabular-nums">
                    {load} job{load !== 1 ? "s" : ""}
                  </span>
                  {trunkLeaders[t] && (
                    <span className="truncate text-[9.5px] text-muted-foreground max-w-full px-0.5">
                      {trunkLeaders[t]}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <hr className="border-border" />

          {/* Fill order rows */}
          <div className="space-y-2">
            {foList.map((fo) => {
              const assigned = local[fo.id] ?? "";
              return (
                <div key={fo.id} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="font-mono text-[12.5px] font-semibold tabular-nums text-foreground">
                      {packLabel(fo)}
                    </span>
                    {fo.fillOrder && (
                      <span className="ml-2 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                        {fo.fillOrder}
                      </span>
                    )}
                  </div>
                  {/* Trunk selector */}
                  <div className="flex flex-shrink-0 gap-1">
                    {TRUNK_ORDER.map((t) => {
                      const color = TRUNK_COLORS[t] ?? "#9ca3af";
                      const isSelected = assigned === t;
                      return (
                        <button
                          key={t}
                          onClick={() => handleAssign(fo.id, t)}
                          title={t}
                          className={cn(
                            "h-7 w-7 rounded-md text-[10.5px] font-bold transition",
                            isSelected
                              ? "text-white shadow-sm"
                              : "bg-muted text-muted-foreground hover:opacity-80",
                          )}
                          style={isSelected ? { backgroundColor: color } : undefined}
                        >
                          {t.replace("TK", "")}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => handleAssign(fo.id, "")}
                      title="Clear"
                      className={cn(
                        "h-7 w-7 rounded-md text-[10.5px] transition",
                        !assigned
                          ? "bg-foreground/10 font-bold text-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80",
                      )}
                    >
                      —
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleApply}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
