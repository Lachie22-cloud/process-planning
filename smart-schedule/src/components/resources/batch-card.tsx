import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/ui/cn";
import { BATCH_STATUSES } from "@/lib/constants/statuses";
import { Eye, Move, CalendarClock, AlertTriangle } from "lucide-react";
import type { Batch } from "@/types/batch";
import type { Resource } from "@/types/resource";
/** Derive fill requirement label from fillRequirement field or ipt fallback */
function getFillLabel(batch: Batch): string {
  if (batch.fillRequirement && batch.fillRequirement !== "Standard") return batch.fillRequirement;
  if (batch.ipt === 1) return "Fill within 24hrs";
  if (batch.ipt === 2) return "Fill within 48hrs";
  return "Standard";
}

interface BatchCardProps {
  batch: Batch;
  resource: Resource | undefined;
  isHighlighted?: boolean;
  isSpotlighted?: boolean;
  isDimmed?: boolean;
  isDragging?: boolean;
  draggable?: boolean;
  canSchedule?: boolean;
  onClick?: (batch: Batch) => void;
  onDragStart?: (batch: Batch, e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onMoveStart?: (batch: Batch) => void;
  onReschedule?: (batch: Batch) => void;
}

/** Returns card background + border classes and left-border color based on material availability & vetting */
function getCardStyle(batch: Batch): { bgClass: string; borderColor: string } {
  // Purple overrules everything when not vetted
  if (batch.vettingStatus === "pending")
    return {
      bgClass: "bg-purple-50/70 border-purple-200 dark:bg-purple-950/30 dark:border-purple-800",
      borderColor: "#a855f7", // purple-500
    };

  // Grey: nothing available
  if (!batch.rmAvailable && !batch.packagingAvailable)
    return {
      bgClass: "bg-gray-50 border-gray-200 dark:bg-gray-800/40 dark:border-gray-700",
      borderColor: "#9ca3af", // gray-400
    };
  // Pink: packaging here but raws are NOT
  if (!batch.rmAvailable)
    return {
      bgClass: "bg-pink-50/70 border-pink-200 dark:bg-pink-950/30 dark:border-pink-800",
      borderColor: "#ec4899", // pink-500
    };
  // Blue: raws here but packaging is NOT
  if (!batch.packagingAvailable)
    return {
      bgClass: "bg-blue-50/70 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800",
      borderColor: "#3b82f6", // blue-500
    };

  // Green: everything here
  return {
    bgClass: "bg-green-50/70 border-green-200 dark:bg-green-950/30 dark:border-green-800",
    borderColor: "#22c55e", // green-500
  };
}


export function BatchCard({
  batch,
  resource,
  isHighlighted = false,
  isSpotlighted = false,
  isDimmed = false,
  isDragging = false,
  draggable = false,
  canSchedule = false,
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
  const statusCfg = BATCH_STATUSES[batch.status];

  return (
    <div
      data-batch-id={batch.id}
      className={cn(
        "group relative cursor-pointer rounded-lg border px-2.5 py-2 text-xs shadow-sm transition-all hover:shadow-md",
        cardStyle.bgClass,
        isHighlighted && "ring-2 ring-primary ring-offset-1",
        isSpotlighted && "z-[35] ring-2 ring-amber-400 shadow-[0_0_0_4px_rgba(245,158,11,0.3),0_0_20px_rgba(245,158,11,0.4)] scale-[1.02] animate-pulse",
        isDimmed && "opacity-30",
        isDragging && "opacity-60 shadow-lg",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
      style={{ borderLeftWidth: 4, borderLeftColor: cardStyle.borderColor }}
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
      {/* Row 1: Bulk code (bold, left) + SAP order (right) + action buttons */}
      <div className="flex items-center justify-between gap-1">
        <span className="font-mono text-[13px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100 truncate">
          {batch.bulkCode ?? batch.sapOrder}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {canSchedule && onReschedule && (!batch.rmAvailable || !batch.packagingAvailable) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="hidden group-hover:inline-flex items-center justify-center h-4 w-4 rounded hover:bg-gray-500/10 text-gray-400 hover:text-gray-600 transition-colors"
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
          {isOverCapacity && (
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              </TooltipTrigger>
              <TooltipContent>
                Exceeds capacity ({resource!.maxCapacity?.toLocaleString()}L)
              </TooltipContent>
            </Tooltip>
          )}
          <span className="font-mono text-[10px] text-gray-400 dark:text-gray-500">
            {batch.bulkCode ? batch.sapOrder : batch.materialCode}
          </span>
        </div>
      </div>

      {/* Row 2: Material description */}
      <div className="mt-0.5 truncate text-gray-500 dark:text-gray-400 leading-tight">
        {batch.materialDescription ?? "\u2014"}
      </div>

      {/* Row 3: Color group */}
      {batch.sapColorGroup && (
        <div className="mt-0.5 text-[10px] font-medium uppercase text-gray-400 dark:text-gray-500">
          {batch.sapColorGroup}
        </div>
      )}

      {/* Row 4: Volume (bold) + resource + pack size */}
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="font-mono text-sm font-bold tabular-nums text-gray-900 dark:text-gray-100">
          {batch.batchVolume != null
            ? `${batch.batchVolume.toLocaleString()}L`
            : "\u2014"}
        </span>
        <div className="flex items-center gap-1.5 text-[10px] text-gray-400 dark:text-gray-500">
          {resource && (
            <span className="truncate max-w-[80px]">{resource.name}</span>
          )}
          {batch.packSize && (
            <span>{batch.packSize}</span>
          )}
        </div>
      </div>

      {/* Row 5: Pills */}
      <div className="mt-1.5 flex items-center gap-1 flex-wrap">
        {!batch.rmAvailable && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-pink-500 text-white">
            WOM
          </span>
        )}
        {!batch.packagingAvailable && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-blue-500 text-white">
            WOP
          </span>
        )}

        {/* Status badge */}
        <span
          className={cn(
            "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold leading-none uppercase",
            statusCfg?.bgClass ?? "bg-muted",
            statusCfg?.textClass ?? "text-muted-foreground",
          )}
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
            style={{ backgroundColor: statusCfg?.color }}
          />
          {statusCfg?.label ?? batch.status}
        </span>

        {isOverCapacity && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-red-500 text-white">
            OVER
          </span>
        )}
        {isUnderCapacity && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-amber-500 text-white">
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
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-emerald-500 text-white">
            VETTED
          </span>
        )}
        {/* Not vetted is indicated by purple left border */}

        {(() => {
          const fill = getFillLabel(batch);
          if (fill === "Standard") return null;
          const is24 = fill.includes("24");
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase text-white",
                    is24 ? "bg-red-500" : "bg-orange-500",
                  )}
                >
                  {is24 ? "24hr" : "48hr"}
                </span>
              </TooltipTrigger>
              <TooltipContent>{fill}</TooltipContent>
            </Tooltip>
          );
        })()}

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

        {/* Observation & EBR pills */}
        {batch.observationRequired && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-purple-500 text-white">
            OBS
          </span>
        )}
        {batch.ebrBatch && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-indigo-500 text-white">
            EBR
          </span>
        )}
      </div>
    </div>
  );
}
