import { useMemo, useCallback } from "react";
import { cn } from "@/lib/ui/cn";
import { BatchCard } from "./batch-card";
import type { DropTarget } from "./resource-lane";
import type { Batch, CoverageLevel } from "@/types/batch";
import type { Resource } from "@/types/resource";
import type { LidFlags } from "@/hooks/use-batch-lid-flags";

interface GroupedPotLaneProps {
  groupName: string;
  resources: Resource[];
  dates: string[];
  batches: Batch[];
  dayBlockedMap?: Map<string, string | null>;
  bookendDates?: Set<string>;
  highlightedBatchIds?: Set<string>;
  draggedBatchId?: string | null;
  dropTargets?: Map<string, DropTarget>;
  canDrag?: boolean;
  canSchedule?: boolean;
  coverageLevels?: Map<string, CoverageLevel>;
  lidFlags?: Map<string, LidFlags>;
  alertBatchIds?: Set<string>;
  onBatchClick?: (batch: Batch) => void;
  onDragStart?: (batch: Batch, e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onDrop?: (resourceId: string, date: string) => void;
  onMoveStart?: (batch: Batch) => void;
  onReschedule?: (batch: Batch) => void;
}

export function GroupedPotLane({
  groupName,
  resources,
  dates,
  batches,
  dayBlockedMap,
  bookendDates,
  highlightedBatchIds,
  draggedBatchId,
  dropTargets,
  canDrag = false,
  canSchedule = false,
  coverageLevels,
  lidFlags,
  alertBatchIds,
  onBatchClick,
  onDragStart,
  onDragEnd,
  onDrop,
  onMoveStart,
  onReschedule,
}: GroupedPotLaneProps) {
  // Group batches by date (combining from all resources in group)
  const batchesByDate = useMemo(() => {
    const map = new Map<string, Batch[]>();
    for (const date of dates) {
      map.set(date, []);
    }
    for (const batch of batches) {
      if (batch.planDate && map.has(batch.planDate)) {
        map.get(batch.planDate)!.push(batch);
      }
    }
    return map;
  }, [batches, dates]);

  // For drops: find the best (least-loaded) valid resource in the group for a date
  const getBestDropResource = useCallback(
    (date: string): string | null => {
      if (!dropTargets) return null;

      let bestId: string | null = null;
      let bestCount = Infinity;

      for (const resource of resources) {
        const key = `${resource.id}:${date}`;
        const target = dropTargets.get(key);
        if (target?.valid) {
          const count = batches.filter(
            (b) => b.planResourceId === resource.id && b.planDate === date,
          ).length;
          if (count < bestCount) {
            bestCount = count;
            bestId = resource.id;
          }
        }
      }
      return bestId;
    },
    [resources, dropTargets, batches],
  );

  // Get grouped drop validity for a date (valid if ANY resource in group is valid)
  const getGroupDropState = useCallback(
    (date: string): { valid: boolean; warning?: string } | undefined => {
      if (!draggedBatchId || !dropTargets) return undefined;

      let anyValid = false;
      let warning: string | undefined;

      for (const resource of resources) {
        const key = `${resource.id}:${date}`;
        const target = dropTargets.get(key);
        if (target?.valid) {
          anyValid = true;
          if (target.warning) warning = target.warning;
        }
      }

      const hasAny = resources.some((r) =>
        dropTargets.has(`${r.id}:${date}`),
      );
      if (!anyValid && hasAny) return { valid: false };
      if (!anyValid) return undefined;

      return { valid: true, warning };
    },
    [draggedBatchId, dropTargets, resources],
  );

  // Trunk line summary
  const trunkInfo = useMemo(() => {
    const trunks = [
      ...new Set(resources.map((r) => r.trunkLine).filter(Boolean)),
    ];
    return trunks.join(", ");
  }, [resources]);

  // Capacity range summary
  const capacityInfo = useMemo(() => {
    const caps = resources
      .map((r) => r.maxCapacity)
      .filter((c): c is number => c != null);
    if (caps.length === 0) return null;
    const min = Math.min(...resources.map((r) => r.minCapacity ?? 0));
    const max = Math.max(...caps);
    return `${min.toLocaleString()}\u2013${max.toLocaleString()}L`;
  }, [resources]);

  return (
    <div className="contents">
      {/* Group label cell */}
      <div className="sticky left-0 z-20 flex flex-col justify-center border-b border-r bg-card px-3 py-2">
        <span className="font-semibold text-sm truncate">{groupName}</span>
        <span className="text-[10px] text-muted-foreground">
          {resources.length} pot{resources.length !== 1 ? "s" : ""}
          {trunkInfo && ` \u00B7 Trunk ${trunkInfo}`}
          {capacityInfo && ` \u00B7 ${capacityInfo}`}
        </span>
      </div>

      {/* Day cells */}
      {dates.map((date) => {
        const dayBatches = batchesByDate.get(date) ?? [];
        const isDragging = !!draggedBatchId;
        const isDayBlocked = dayBlockedMap?.has(date) ?? false;
        const dayBlockReason = dayBlockedMap?.get(date) ?? null;
        const groupDrop = getGroupDropState(date);

        let dragCellClass = "";
        if (isDragging && groupDrop && !isDayBlocked) {
          if (groupDrop.valid && groupDrop.warning) {
            dragCellClass =
              "border border-dashed border-amber-400/60 bg-amber-50/20 dark:bg-amber-950/10";
          } else if (groupDrop.valid) {
            dragCellClass =
              "border border-dashed border-emerald-400/50 bg-emerald-50/20 dark:bg-emerald-950/10";
          } else {
            dragCellClass =
              "border border-dashed border-red-300/40 bg-red-50/10 dark:bg-red-950/10";
          }
        }

        const isBookend = bookendDates?.has(date);
        return (
          <div
            key={date}
            className={cn(
              "relative flex min-h-[80px] flex-col border-b border-r p-1.5 transition-colors",
              isBookend && "bg-muted/40 opacity-70",
              isDayBlocked && "bg-muted/60",
              dragCellClass,
            )}
            onDragOver={(e) => {
              if (!isDragging || !groupDrop?.valid) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDragEnter={(e) => {
              if (!isDragging || !groupDrop?.valid) return;
              e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (!groupDrop?.valid) return;
              const targetResourceId = getBestDropResource(date);
              if (targetResourceId) {
                onDrop?.(targetResourceId, date);
              }
            }}
          >
            {/* Day block overlay — grey out entire cell */}
            {isDayBlocked && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted/70">
                {dayBlockReason && (
                  <span className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-wide text-center px-1 select-none">
                    {dayBlockReason}
                  </span>
                )}
              </div>
            )}

            {/* Batch count indicator */}
            {dayBatches.length > 0 && !isDayBlocked && (
              <div className="mb-1 flex justify-end">
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {dayBatches.length} batch
                  {dayBatches.length !== 1 ? "es" : ""}
                </span>
              </div>
            )}

            {/* Warning for drops with caveats */}
            {isDragging && groupDrop?.valid && groupDrop.warning && !isDayBlocked && (
              <div className="mb-1 text-[10px] font-medium text-amber-700 dark:text-amber-300 text-center">
                {groupDrop.warning}
              </div>
            )}

            {/* Batch cards stacked */}
            {!isDayBlocked && (
              <div className="flex flex-col gap-1">
                {dayBatches.map((batch) => {
                  const batchResource = resources.find(
                    (r) => r.id === batch.planResourceId,
                  );
                  return (
                    <BatchCard
                      key={batch.id}
                      batch={batch}
                      resource={batchResource ?? resources[0]}
                      isHighlighted={highlightedBatchIds?.has(batch.id)}
                      isDragging={draggedBatchId === batch.id}
                      draggable={canDrag}
                      canSchedule={canSchedule}
                      isConflict={
                        resources[0]?.groupCapacity != null
                          ? dayBatches.length > resources[0].groupCapacity
                          : dayBatches.length > (batchResource?.maxBatchesPerDay ?? resources[0]?.maxBatchesPerDay ?? Infinity)
                      }
                      coverageLevel={coverageLevels?.get(batch.id)}
                      hasAlert={alertBatchIds?.has(batch.id)}
                      hasRedLid={lidFlags?.get(batch.id)?.hasRedLid}
                      hasBlueLid={lidFlags?.get(batch.id)?.hasBlueLid}
                      onClick={onBatchClick}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                      onMoveStart={onMoveStart}
                      onReschedule={onReschedule}
                    />
                  );
                })}
              </div>
            )}

            {/* Empty state */}
            {dayBatches.length === 0 && !isDayBlocked && (
              <div
                className={cn(
                  "flex flex-1 items-center justify-center text-[10px]",
                  isDragging && groupDrop?.valid
                    ? "text-emerald-600/70 dark:text-emerald-400/70 font-medium"
                    : "text-muted-foreground/40",
                )}
              >
                {isDragging && groupDrop?.valid ? "Drop here" : "\u2014"}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
