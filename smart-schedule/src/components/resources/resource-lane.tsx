import { useMemo } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/ui/cn";
import { ArrowLeftFromLine, ArrowRightFromLine } from "lucide-react";
import { BatchCard } from "./batch-card";
import { BlockedOverlay } from "./blocked-overlay";
import type { Batch } from "@/types/batch";
import type { Resource } from "@/types/resource";
import type { ResourceBlock } from "@/types/site";
import type { MovementInfo } from "@/hooks/use-schedule-movements";

export interface DropTarget {
  resourceId: string;
  date: string;
  valid: boolean;
  warning?: string;
}

interface ResourceLaneProps {
  resource: Resource;
  dates: string[];
  batches: Batch[];
  blocks: ResourceBlock[];
  dayBlockedMap?: Map<string, string | null>;
  bookendDates?: Set<string>;
  highlightedBatchIds?: Set<string>;
  spotlightBatchId?: string | null;
  spotlightTargetResourceId?: string | null;
  movementDirections?: Map<string, MovementInfo>;
  draggedBatchId?: string | null;
  dragOver?: DropTarget | null;
  dropTargets?: Map<string, DropTarget>;
  canDrag?: boolean;
  canSchedule?: boolean;
  onBatchClick?: (batch: Batch) => void;
  onDragStart?: (batch: Batch, e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onDragOver?: (resourceId: string, date: string, e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (resourceId: string, date: string) => void;
  onMoveStart?: (batch: Batch) => void;
  onReschedule?: (batch: Batch) => void;
}

function getCellKey(resourceId: string, date: string) {
  return `${resourceId}:${date}`;
}

export function ResourceLane({
  resource,
  dates,
  batches,
  blocks,
  dayBlockedMap,
  bookendDates,
  highlightedBatchIds,
  spotlightBatchId,
  spotlightTargetResourceId,
  movementDirections,
  draggedBatchId,
  dropTargets,
  canDrag = false,
  canSchedule = false,
  onBatchClick,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onMoveStart,
  onReschedule,
}: ResourceLaneProps) {
  // Group batches by date
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

  // Check which dates are blocked for this resource
  const blockedDates = useMemo(() => {
    const map = new Map<string, ResourceBlock>();
    for (const date of dates) {
      const block = blocks.find(
        (b) =>
          b.resourceId === resource.id &&
          b.startDate <= date &&
          b.endDate >= date,
      );
      if (block) {
        map.set(date, block);
      }
    }
    return map;
  }, [blocks, dates, resource.id]);

  return (
    <div className="contents">
      {/* Resource label cell */}
      <div className={cn(
        "sticky left-0 z-20 flex flex-col justify-center border-b border-r bg-card px-3 py-2",
        spotlightTargetResourceId === resource.id && "ring-2 ring-inset ring-amber-400/50",
      )}>
        <span className="font-semibold text-sm truncate">
          {resource.displayName ?? resource.resourceCode}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {resource.trunkLine && `Trunk ${resource.trunkLine} \u00B7 `}
          {resource.minCapacity != null && resource.maxCapacity != null
            ? `${resource.minCapacity.toLocaleString()}\u2013${resource.maxCapacity.toLocaleString()}L`
            : resource.resourceType}
        </span>
      </div>

      {/* Day cells */}
      {dates.map((date) => {
        const dayBatches = batchesByDate.get(date) ?? [];
        const block = blockedDates.get(date);
        const isDayBlocked = dayBlockedMap?.has(date) ?? false;
        const dayBlockReason = dayBlockedMap?.get(date) ?? null;
        // Get drop target state for this cell
        const cellKey = getCellKey(resource.id, date);
        const target = draggedBatchId ? dropTargets?.get(cellKey) : undefined;
        const isDragging = !!draggedBatchId;

        // Determine cell highlighting classes when dragging
        let dragCellClass = "";
        if (isDragging && target && !isDayBlocked) {
          if (target.valid && target.warning) {
            dragCellClass =
              "border border-dashed border-amber-400/60 bg-amber-50/20 dark:bg-amber-950/10";
          } else if (target.valid) {
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
              if (!isDragging || !target?.valid) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              onDragOver?.(resource.id, date, e);
            }}
            onDragEnter={(e) => {
              if (!isDragging || !target?.valid) return;
              e.preventDefault();
            }}
            onDragLeave={() => onDragLeave?.()}
            onDrop={(e) => {
              e.preventDefault();
              if (!target?.valid) return;
              onDrop?.(resource.id, date);
            }}
          >
            {block && !isDayBlocked && <BlockedOverlay reason={block.reason} />}

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

            {/* Cell indicator: movement arrow (if any batch moved) */}
            {dayBatches.length > 0 && !block && !isDayBlocked && (() => {
              // Check if any batch in this cell has a movement direction
              const cellMovements = dayBatches
                .map((b) => movementDirections?.get(b.id))
                .filter((m): m is MovementInfo => !!m && (m.direction === "pulled" || m.direction === "pushed"));

              if (cellMovements.length > 0) {
                // Show the first movement indicator (pulled takes priority over pushed)
                const pulled = cellMovements.find((m) => m.direction === "pulled");
                const movement = pulled ?? cellMovements[0]!;
                const isPulled = movement.direction === "pulled";

                return (
                  <div className="mb-1 flex justify-end">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className={cn(
                            "inline-flex items-center gap-0.5 rounded-sm px-1.5 py-0.5 text-[9px] font-bold leading-none",
                            isPulled
                              ? "bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-300"
                              : "bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300",
                          )}
                        >
                          {isPulled ? (
                            <ArrowLeftFromLine className="h-3 w-3 shrink-0" />
                          ) : (
                            <ArrowRightFromLine className="h-3 w-3 shrink-0" />
                          )}
                          {isPulled ? "Pulled Forward" : "Pushed Out"}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <div className="font-semibold">{isPulled ? "Pulled Forward" : "Pushed Out"}</div>
                        {movement.reason && (
                          <div className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">{movement.reason}</div>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                );
              }

              return null;
            })()}

            {/* Warning for drops with caveats */}
            {isDragging && target?.valid && target.warning && !isDayBlocked && (
              <div className="mb-1 text-[10px] font-medium text-amber-700 dark:text-amber-300 text-center">
                {target.warning}
              </div>
            )}

            {/* Batch cards */}
            {!isDayBlocked && (
              <div className="flex flex-col gap-1">
                {dayBatches.map((batch) => (
                  <BatchCard
                    key={batch.id}
                    batch={batch}
                    resource={resource}
                    isHighlighted={highlightedBatchIds?.has(batch.id)}
                    isSpotlighted={spotlightBatchId === batch.id}
                    isDimmed={
                      !!spotlightBatchId && spotlightBatchId !== batch.id
                    }
                    isDragging={draggedBatchId === batch.id}
                    draggable={canDrag}
                    canSchedule={canSchedule}
                    isConflict={dayBatches.length > (resource.groupCapacity ?? resource.maxBatchesPerDay)}
                    onClick={onBatchClick}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                    onMoveStart={onMoveStart}
                    onReschedule={onReschedule}
                  />
                ))}
              </div>
            )}

            {/* Empty state */}
            {dayBatches.length === 0 && !block && !isDayBlocked && (
              <div className={cn(
                "flex flex-1 items-center justify-center text-[10px]",
                isDragging && target?.valid
                  ? "text-emerald-600/70 dark:text-emerald-400/70 font-medium"
                  : "text-muted-foreground/40",
              )}>
                {isDragging && target?.valid ? "Drop here" : "\u2014"}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
