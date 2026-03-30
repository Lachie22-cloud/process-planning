import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/ui/cn";
import { BATCH_STATUSES } from "@/lib/constants/statuses";
import { COLOR_GROUPS } from "@/lib/constants/color-groups";
import { useColourGroups } from "@/hooks/use-colour-groups";
import { Eye, Move, CalendarClock } from "lucide-react";
import type { Batch, CoverageLevel } from "@/types/batch";
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
  isConflict?: boolean;
  coverageLevel?: CoverageLevel | null;
  hasRedLid?: boolean;
  hasBlueLid?: boolean;
  onClick?: (batch: Batch) => void;
  onDragStart?: (batch: Batch, e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onMoveStart?: (batch: Batch) => void;
  onReschedule?: (batch: Batch) => void;
}

/** Card background + left-border color based on material availability & vetting */
function getCardStyle(batch: Batch): { bgClass: string; borderColor: string } {
  // Purple overrules everything when not vetted
  if (batch.vettingStatus === "pending")
    return {
      bgClass: "bg-purple-50/40 border-purple-100 dark:bg-purple-950/20 dark:border-purple-900",
      borderColor: "#a855f7", // purple-500
    };

  // Grey: nothing available
  if (!batch.rmAvailable && !batch.packagingAvailable)
    return {
      bgClass: "bg-gray-50/50 border-gray-100 dark:bg-gray-800/30 dark:border-gray-700",
      borderColor: "#9ca3af", // gray-400
    };
  // Pink: packaging here but raws are NOT
  if (!batch.rmAvailable)
    return {
      bgClass: "bg-pink-50/40 border-pink-100 dark:bg-pink-950/20 dark:border-pink-900",
      borderColor: "#ec4899", // pink-500
    };
  // Blue: raws here but packaging is NOT
  if (!batch.packagingAvailable)
    return {
      bgClass: "bg-blue-50/40 border-blue-100 dark:bg-blue-950/20 dark:border-blue-900",
      borderColor: "#3b82f6", // blue-500
    };

  // Green: everything here
  return {
    bgClass: "bg-green-50/40 border-green-100 dark:bg-green-950/20 dark:border-green-900",
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
  isConflict = false,
  coverageLevel,
  hasRedLid = false,
  hasBlueLid = false,
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

  const { data: colourGroups } = useColourGroups();
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
      {/* Row 1: Bulk code (bold, left) + SAP order (bold, right) + action buttons */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-mono text-[13px] font-extrabold tracking-tight text-black truncate">
            {batch.bulkCode ?? "\u2014"}
          </span>
          {batch.bulkBatchNumber && (
            <span className="font-mono text-[13px] font-extrabold tracking-tight text-black truncate">
              {batch.bulkBatchNumber}
            </span>
          )}
        </div>
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
          <span className="font-mono text-[13px] font-extrabold tracking-tight text-black">
            {batch.sapOrder}
          </span>
        </div>
      </div>

      {/* Row 2: Material description */}
      <div className="mt-0.5 truncate text-black leading-tight">
        {batch.materialDescription ?? "\u2014"}
      </div>

      {/* Row 3: Color group — prefer database-driven groups, fall back to hardcoded */}
      {batch.sapColorGroup && (() => {
        const dbGroup = colourGroups?.find((g) => g.code === batch.sapColorGroup);
        const colour = dbGroup?.hexColour ?? COLOR_GROUPS[batch.sapColorGroup]?.color ?? "#1f2937";
        const name = dbGroup?.name ?? COLOR_GROUPS[batch.sapColorGroup]?.name ?? batch.sapColorGroup;
        return (
          <div
            className="mt-0.5 text-[10px] font-medium uppercase"
            style={{ color: colour }}
          >
            {name}
          </div>
        );
      })()}

      {/* Row 4: Volume + resource + pack size */}
      <div className="mt-0.5 flex items-baseline justify-between gap-2">
        <span className="font-mono tabular-nums font-semibold text-black">
          {batch.batchVolume != null
            ? `${batch.batchVolume.toLocaleString()}L`
            : "\u2014"}
        </span>
        <div className="flex items-center gap-1.5 text-[10px] text-black">
          {resource && (
            <span className="truncate max-w-[80px]">{resource.displayName ?? resource.resourceCode}</span>
          )}
          {batch.packSize && (
            <span>{batch.packSize}</span>
          )}
        </div>
      </div>

      {/* Row 5: Pills — light bg + dark text, no border */}
      <div className="mt-1.5 flex items-center gap-1 flex-wrap">
        {!batch.rmAvailable && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-200">
            WOM
          </span>
        )}
        {!batch.packagingAvailable && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200">
            WOP
          </span>
        )}

        {/* Lid type pills */}
        {hasRedLid && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200">
            RL
          </span>
        )}
        {hasBlueLid && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-200">
            BL
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

        {(batch.status as string) === "Job Complete" && batch.excessPaintComment && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200">
            EXCESS
          </span>
        )}

        {isOverCapacity && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200">
            OVER
          </span>
        )}
        {isConflict && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200">
            CONFLICT
          </span>
        )}

        {/* Vetting — approved only; not vetted shown via purple card */}
        {batch.vettingStatus === "approved" && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200">
            VETTED
          </span>
        )}

        {(() => {
          const fill = getFillLabel(batch);
          if (fill === "Standard") return null;
          const is24 = fill.includes("24");
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase",
                    is24
                      ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200"
                      : "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-200",
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
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200">
            OBS
          </span>
        )}
        {batch.ebrBatch && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200">
            EBR
          </span>
        )}

        {/* Coverage pills */}
        {coverageLevel === "Stock Out" && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200">
            OOS
          </span>
        )}
        {coverageLevel === "Critical" && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-200">
            CRIT
          </span>
        )}
        {coverageLevel === "Low" && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200">
            LOW COV
          </span>
        )}
      </div>
    </div>
  );
}
