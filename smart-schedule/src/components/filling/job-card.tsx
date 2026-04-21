import { useState, useRef } from "react";
import { GripVertical, ArrowLeftRight } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { BATCH_STATUSES } from "@/lib/constants/statuses";
import { HoldUpPopover } from "./holdup-popover";
import type { FillingJob, FillingOverride } from "./types";

/** Left-border colour based on material availability — matches BatchCard exactly */
function getBorderColor(job: FillingJob): string {
  if (job.vettingStatus === "pending") return "#a855f7";
  if (!job.rmAvailable && !job.packagingAvailable) return "#9ca3af";
  if (!job.rmAvailable) return "#ec4899";
  if (!job.packagingAvailable) return "#3b82f6";
  return "#22c55e";
}

function getBgClass(job: FillingJob): string {
  if (job.vettingStatus === "pending")
    return "bg-purple-50/40 border-purple-100 dark:bg-purple-950/20 dark:border-purple-900";
  if (!job.rmAvailable && !job.packagingAvailable)
    return "bg-gray-50/50 border-gray-100 dark:bg-gray-800/30 dark:border-gray-700";
  if (!job.rmAvailable)
    return "bg-pink-50/40 border-pink-100 dark:bg-pink-950/20 dark:border-pink-900";
  if (!job.packagingAvailable)
    return "bg-blue-50/40 border-blue-100 dark:bg-blue-950/20 dark:border-blue-900";
  return "bg-green-50/40 border-green-100 dark:bg-green-950/20 dark:border-green-900";
}

interface JobCardProps {
  job: FillingJob;
  override?: FillingOverride | null;
  splitTo?: string[];
  isReceived?: boolean;
  sourceTrunkLine?: string | null;
  isDragging?: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLElement>;
  onOpen?: () => void;
  onSaveComment?: (comment: string) => void;
  onSaveHoldUp?: (note: string | null) => void;
  onDistribute?: () => void;
}

export function JobCard({
  job,
  override,
  splitTo,
  isReceived,
  sourceTrunkLine,
  isDragging,
  dragHandleProps,
  onOpen,
  onSaveComment,
  onSaveHoldUp,
  onDistribute,
}: JobCardProps) {
  const statusCfg = BATCH_STATUSES[job.status];
  const borderColor = getBorderColor(job);
  const bgClass = getBgClass(job);

  const mixerLabel = job.resource
    ? (job.resource.displayName ?? job.resource.resourceCode)
    : "—";

  const currentComment = override?.comment ?? null;
  const holdUpNote = override?.holdUpNote ?? null;

  const [editingComment, setEditingComment] = useState(false);
  const [commentDraft, setCommentDraft] = useState(currentComment ?? "");
  const commentRef = useRef<HTMLInputElement>(null);

  function handleCommentBlur() {
    setEditingComment(false);
    const trimmed = commentDraft.trim();
    if (trimmed !== (currentComment ?? "")) onSaveComment?.(trimmed);
  }

  // Fill orders with pack data
  const fillOrderLines = job.linkedFillOrders.filter(
    (fo) => fo.packSize || fo.quantity || fo.fillMaterial,
  );

  // Multiple distinct pack sizes → offer distribute
  const distinctPacks = new Set(
    job.linkedFillOrders.map((fo) => fo.packSize).filter(Boolean),
  );
  const hasMultiplePacks = distinctPacks.size >= 2;

  // Priority label
  const priorityLabel =
    job.ipt === 1 ? "24hr" : job.ipt === 2 ? "48hr" : null;

  return (
    <div
      className={cn(
        "group relative rounded-lg border px-2.5 py-2 text-xs shadow-sm transition-all",
        bgClass,
        isReceived && "ring-1 ring-violet-300 dark:ring-violet-700",
        isDragging && "opacity-60 shadow-lg",
        onOpen && "cursor-pointer hover:shadow-md",
      )}
      style={{ borderLeftWidth: 4, borderLeftColor: borderColor }}
      onClick={onOpen}
    >
      {/* ── Row 1: SAP order + bulk code + mixer + drag handle ── */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          {dragHandleProps && (
            <span
              {...dragHandleProps}
              onClick={(e) => e.stopPropagation()}
              className="flex-shrink-0 cursor-grab text-muted-foreground/30 transition hover:text-muted-foreground/60 active:cursor-grabbing"
            >
              <GripVertical className="h-3.5 w-3.5" />
            </span>
          )}
          <span className="font-mono text-[13px] font-extrabold tracking-tight truncate">
            {job.sapOrder}
          </span>
          {job.materialCode && (
            <span className="font-mono text-[11px] text-muted-foreground truncate">
              {job.materialCode}
            </span>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          {onSaveHoldUp && (
            <span onClick={(e) => e.stopPropagation()}>
              <HoldUpPopover currentNote={holdUpNote} onSave={onSaveHoldUp} />
            </span>
          )}
          <span className="inline-flex min-w-[40px] justify-center rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px] font-semibold tabular-nums text-foreground">
            {mixerLabel}
          </span>
        </div>
      </div>

      {/* ── Row 2: Material description ── */}
      {job.materialDescription && (
        <div className="mt-0.5 truncate leading-tight text-muted-foreground">
          {job.materialDescription}
        </div>
      )}

      {/* ── Row 3: Fill orders — FG code · qty×pack · description ── */}
      {fillOrderLines.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {fillOrderLines.map((fo) => (
            <div key={fo.id} className="flex items-baseline gap-1.5 text-[10.5px]">
              {fo.fillMaterial && (
                <span className="font-mono text-muted-foreground/80 flex-shrink-0">
                  {fo.fillMaterial}
                </span>
              )}
              {(fo.quantity || fo.packSize) && (
                <span className="font-mono tabular-nums text-foreground font-medium flex-shrink-0">
                  {fo.quantity && fo.packSize
                    ? `${fo.quantity} × ${fo.packSize}`
                    : fo.packSize ?? `×${fo.quantity}`}
                </span>
              )}
              {fo.fillDescription && !fo.fillMaterial && (
                <span className="truncate text-muted-foreground/70 min-w-0">
                  {fo.fillDescription}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Row 4: Hold-up note ── */}
      {holdUpNote && (
        <div className="mt-1 rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          ⚠ {holdUpNote}
        </div>
      )}

      {/* ── Row 5: Pills — status, priority, coverage, routing ── */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {/* Status */}
        {statusCfg && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold leading-none uppercase",
              statusCfg.bgClass,
              statusCfg.textClass,
            )}
          >
            <span
              className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
              style={{ backgroundColor: statusCfg.color }}
            />
            {statusCfg.label}
          </span>
        )}

        {/* Priority */}
        {priorityLabel && (
          <span
            className={cn(
              "inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase",
              job.ipt === 1
                ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200"
                : "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-200",
            )}
          >
            {priorityLabel}
          </span>
        )}

        {/* Coverage */}
        {job.stockCover != null && job.safetyStock != null && job.stockCover <= 0 && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200">
            OOS
          </span>
        )}
        {job.stockCover != null &&
          job.safetyStock != null &&
          job.stockCover > 0 &&
          job.stockCover < job.safetyStock && (
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200">
              LOW COV
            </span>
          )}

        {/* Material availability */}
        {!job.rmAvailable && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-200">
            WOM
          </span>
        )}
        {!job.packagingAvailable && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200">
            WOP
          </span>
        )}

        {/* Special batch flags */}
        {job.observationRequired && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200">
            OBS
          </span>
        )}
        {job.ebrBatch && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200">
            EBR
          </span>
        )}

        {/* Pack-size distribution */}
        {hasMultiplePacks && onDistribute && !splitTo?.length && (
          <button
            onClick={(e) => { e.stopPropagation(); onDistribute(); }}
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-amber-100 text-amber-700 transition hover:bg-amber-200 dark:bg-amber-900 dark:text-amber-200"
          >
            <ArrowLeftRight className="h-2.5 w-2.5" />
            Split packs
          </button>
        )}

        {/* Routing badges */}
        {splitTo?.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200"
          >
            <ArrowLeftRight className="h-2.5 w-2.5" />→ {t}
          </span>
        ))}
        {isReceived && sourceTrunkLine && (
          <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200">
            <ArrowLeftRight className="h-2.5 w-2.5" />from {sourceTrunkLine}
          </span>
        )}
      </div>

      {/* ── Inline comment ── */}
      {onSaveComment && (
        <div className="mt-1" onClick={(e) => e.stopPropagation()}>
          {editingComment ? (
            <input
              ref={commentRef}
              autoFocus
              type="text"
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              onBlur={handleCommentBlur}
              onKeyDown={(e) => {
                if (e.key === "Enter") commentRef.current?.blur();
                if (e.key === "Escape") {
                  setCommentDraft(currentComment ?? "");
                  setEditingComment(false);
                }
              }}
              placeholder="Add note…"
              className="w-full rounded border bg-background px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
            />
          ) : (
            <button
              onClick={() => {
                setCommentDraft(currentComment ?? "");
                setEditingComment(true);
              }}
              className={cn(
                "rounded px-0.5 py-0.5 text-left font-mono text-[10px] italic transition",
                currentComment
                  ? "text-muted-foreground hover:bg-muted/50"
                  : "text-muted-foreground/30 opacity-0 group-hover:opacity-100 hover:bg-muted/50",
              )}
            >
              {currentComment ?? "Add note…"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
