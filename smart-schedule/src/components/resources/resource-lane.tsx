import { useMemo } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/ui/cn";
import { BatchCard } from "./batch-card";
import { BlockedOverlay } from "./blocked-overlay";
import type { Batch } from "@/types/batch";
import type { Resource } from "@/types/resource";
import type { ResourceBlock } from "@/types/site";

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
  highlightedBatchIds?: Set<string>;
  spotlightBatchId?: string | null;
  spotlightTargetResourceId?: string | null;
  movementDirections?: Map<string, "pulled" | "pushed" | "moved">;
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

function CapacityBar({
  totalVolume,
  maxCapacity,
  batchCount,
}: {
  totalVolume: number;
  maxCapacity: number | null;
  batchCount: number;
}) {
  if (maxCapacity == null || maxCapacity === 0) {
    return (
      <span className="text-[10px] text-muted-foreground tabular-nums">
        {batchCount} batch{batchCount !== 1 ? "es" : ""}
      </span>
    );
  }

  const percentage = Math.round((totalVolume / maxCapacity) * 100);
  const barColour =
    percentage > 100
      ? "bg-red-500"
      : percentage > 80
        ? "bg-amber-400"
        : "bg-emerald-500";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-12 rounded-full bg-muted overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", barColour)}
              style={{ width: `${Math.min(percentage, 100)}%` }}
            />
          </div>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {percentage}%
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {totalVolume.toLocaleString()}L / {maxCapacity.toLocaleString()}L
        ({batchCount} batch{batchCount !== 1 ? "es" : ""})
      </TooltipContent>
    </Tooltip>
  );
}

function getCellKey(resourceId: string, date: string) {
  return `${resourceId}:${date}`;
}

export function ResourceLane({
  resource,
  dates,
  batches,
  blocks,
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
        const totalVolume = dayBatches.reduce(
          (sum, b) => sum + (b.batchVolume ?? 0),
          0,
        );

        // Get drop target state for this cell
        const cellKey = getCellKey(resource.id, date);
        const target = draggedBatchId ? dropTargets?.get(cellKey) : undefined;
        const isDragging = !!draggedBatchId;

        // Determine cell highlighting classes when dragging
        let dragCellClass = "";
        if (isDragging && target) {
          if (target.valid && target.warning) {
            // Warning state (e.g. over capacity when allowed, washout required)
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

        return (
          <div
            key={date}
            className={cn(
              "relative flex min-h-[80px] flex-col border-b border-r p-1.5 transition-colors",
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
            {block && <BlockedOverlay reason={block.reason} />}

            {/* Capacity indicator */}
            {dayBatches.length > 0 && !block && (
              <div className="mb-1 flex justify-end">
                <CapacityBar
                  totalVolume={totalVolume}
                  maxCapacity={resource.maxCapacity}
                  batchCount={dayBatches.length}
                />
              </div>
            )}

            {/* Warning for drops with caveats */}
            {isDragging && target?.valid && target.warning && (
              <div className="mb-1 text-[10px] font-medium text-amber-700 dark:text-amber-300 text-center">
                {target.warning}
              </div>
            )}

            {/* Batch cards */}
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
                  movementDirection={movementDirections?.get(batch.id)}
                  onClick={onBatchClick}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onMoveStart={onMoveStart}
                  onReschedule={onReschedule}
                />
              ))}
            </div>

            {/* Empty state */}
            {dayBatches.length === 0 && !block && (
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
