import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/ui/cn";
import { BATCH_STATUSES } from "@/lib/constants/statuses";
import { Eye, Move, CalendarClock } from "lucide-react";
import type { Batch } from "@/types/batch";
import type { Resource } from "@/types/resource";

interface BatchCardProps {
  batch: Batch;
  resource: Resource | undefined;
  isHighlighted?: boolean;
  isSpotlighted?: boolean;
  isDimmed?: boolean;
  isDragging?: boolean;
  draggable?: boolean;
  canSchedule?: boolean;
  /** Movement direction from schedule_movements ('pulled' | 'pushed' | 'moved') */
  movementDirection?: "pulled" | "pushed" | "moved" | null;
  onClick?: (batch: Batch) => void;
  onDragStart?: (batch: Batch, e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onMoveStart?: (batch: Batch) => void;
  onReschedule?: (batch: Batch) => void;
}

function getCardStyle(batch: Batch): { className: string; borderLeftColor?: string } {
  // Grey: nothing available
  if (!batch.rmAvailable && !batch.packagingAvailable)
    return { className: "border-gray-300 bg-gray-50/60 dark:border-gray-600 dark:bg-gray-800/20" };
  // Pink: packaging available but raws are NOT
  if (!batch.rmAvailable)
    return { className: "border-pink-300 bg-pink-50/60 dark:border-pink-800 dark:bg-pink-950/20" };
  // Blue: raws available but packaging is NOT
  if (!batch.packagingAvailable)
    return { className: "border-blue-300 bg-blue-50/60 dark:border-blue-800 dark:bg-blue-950/20" };

  // Green: all available
  const cfg = BATCH_STATUSES[batch.status];
  return {
    className: "border-green-300 bg-green-50/60 dark:border-green-800 dark:bg-green-950/20",
    borderLeftColor: cfg?.color,
  };
}

const MOVEMENT_BORDER: Record<string, string> = {
  pulled: "#16a34a",  // green
  pushed: "#dc2626",  // red
  moved: "#2563eb",   // blue
};

export function BatchCard({
  batch,
  resource,
  isHighlighted = false,
  isSpotlighted = false,
  isDimmed = false,
  isDragging = false,
  draggable = false,
  canSchedule = false,
  movementDirection,
  onClick,
  onDragStart,
  onDragEnd,
  onMoveStart,
  onReschedule,
}: BatchCardProps) {
  const isOverCapacity =
    resource &&
    batch.batchVolume != null &&
    resource.maxCapacity != null &&
    batch.batchVolume > resource.maxCapacity;

  const isUnderCapacity =
    resource &&
    batch.batchVolume != null &&
    resource.minCapacity != null &&
    batch.batchVolume < resource.minCapacity;

  const cardStyle = getCardStyle(batch);

  // Movement direction overrides status border color
  const borderLeft = movementDirection
    ? MOVEMENT_BORDER[movementDirection]
    : cardStyle.borderLeftColor;

  return (
    <div
      data-batch-id={batch.id}
      className={cn(
        "group relative cursor-pointer rounded-md border px-2 py-1.5 text-xs transition-all hover:shadow-md",
        cardStyle.className,
        isHighlighted && "ring-2 ring-primary ring-offset-1",
        isSpotlighted && "z-[35] ring-2 ring-amber-400 shadow-[0_0_0_4px_rgba(245,158,11,0.3),0_0_20px_rgba(245,158,11,0.4)] scale-[1.02] animate-pulse",
        isDimmed && "opacity-30",
        isDragging && "opacity-60 shadow-lg",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
      style={borderLeft ? { borderLeftWidth: 3, borderLeftColor: borderLeft } : undefined}
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", batch.id);
        onDragStart?.(batch, e);
      }}
      onDragEnd={() => onDragEnd?.()}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(batch);
      }}
    >
      {/* Top row: SAP order + material code + move buttons */}
      <div className="flex items-center justify-between gap-1">
        <span className="font-semibold truncate">{batch.sapOrder}</span>
        <div className="flex items-center gap-1 shrink-0">
          {canSchedule && onReschedule && (!batch.rmAvailable || !batch.packagingAvailable) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="hidden group-hover:inline-flex items-center justify-center h-4 w-4 rounded hover:bg-gray-500/10 text-gray-500 hover:text-gray-600 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    onReschedule(batch);
                  }}
                  aria-label={`Reschedule batch ${batch.sapOrder}`}
                >
                  <CalendarClock className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Reschedule (WOM/WOP)</TooltipContent>
            </Tooltip>
          )}
          {canSchedule && onMoveStart && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="hidden group-hover:inline-flex items-center justify-center h-4 w-4 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMoveStart(batch);
                  }}
                  aria-label={`Move batch ${batch.sapOrder}`}
                >
                  <Move className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Move to best placement</TooltipContent>
            </Tooltip>
          )}
          {batch.materialCode && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {batch.materialCode}
            </span>
          )}
        </div>
      </div>

      {/* Material description */}
      <div className="mt-0.5 truncate text-muted-foreground leading-tight">
        {batch.materialDescription ?? "\u2014"}
      </div>

      {/* Colour code + volume row */}
      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        {batch.sapColorGroup && (
          <span className="font-medium uppercase">{batch.sapColorGroup}</span>
        )}
        <span className="font-mono tabular-nums font-semibold text-foreground">
          {batch.batchVolume != null
            ? `${batch.batchVolume.toLocaleString()}L`
            : "\u2014"}
        </span>
        {batch.packSize && (
          <>
            <span className="text-muted-foreground/50">&middot;</span>
            <span>{batch.packSize}</span>
          </>
        )}
      </div>

      {/* Status & alert indicators */}
      <div className="mt-1 flex items-center gap-1 flex-wrap">
        {!batch.rmAvailable && (
          <span className="inline-flex items-center rounded-sm border px-1 py-0.5 text-[9px] font-semibold text-pink-600">
            WOM
          </span>
        )}
        {!batch.packagingAvailable && (
          <span className="inline-flex items-center rounded-sm border px-1 py-0.5 text-[9px] font-semibold text-blue-600">
            WOP
          </span>
        )}

        {/* Status badge (only for non-Planned) */}
        {batch.status !== "Planned" && (
          <span className="inline-flex items-center rounded-sm px-1 py-0.5 text-[9px] font-semibold bg-muted text-muted-foreground">
            {batch.status}
          </span>
        )}

        {isOverCapacity && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center rounded-sm bg-red-100 px-1 py-0.5 text-[9px] font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">
                OVER
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Exceeds capacity ({resource!.maxCapacity?.toLocaleString()}L)
            </TooltipContent>
          </Tooltip>
        )}
        {isUnderCapacity && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center rounded-sm bg-amber-100 px-1 py-0.5 text-[9px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                UNDER
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Below minimum ({resource!.minCapacity?.toLocaleString()}L)
            </TooltipContent>
          </Tooltip>
        )}

        {/* Vetting status */}
        {batch.vettingStatus === "approved" && (
          <span className="inline-flex items-center rounded-sm border border-emerald-300 px-1 py-0.5 text-[9px] font-semibold text-emerald-700">
            VETTED
          </span>
        )}
        {batch.vettingStatus === "pending" && (
          <span className="inline-flex items-center rounded-sm border border-amber-300 px-1 py-0.5 text-[9px] font-semibold text-amber-700">
            NOT VETTED
          </span>
        )}

        {batch.qcObservedStage && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Eye className="h-3 w-3 text-purple-500" />
            </TooltipTrigger>
            <TooltipContent>
              QC Observation: {batch.qcObservedStage}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
