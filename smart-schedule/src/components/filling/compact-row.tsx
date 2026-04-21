import { useState, useRef } from "react";
import { GripVertical, ArrowLeftRight } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { FlagWrap, getJobFlags } from "./flag-pill";
import { HoldUpPopover } from "./holdup-popover";
import { STATUS_ACCENT } from "./active-row";
import type { FillingJob, FillingOverride } from "./types";

interface CompactRowProps {
  job: FillingJob;
  override?: FillingOverride | null;
  splitTo?: string[];
  isReceived?: boolean;
  sourceTrunkLine?: string | null;
  onOpen?: () => void;
  onSaveComment?: (comment: string) => void;
  onSaveHoldUp?: (note: string | null) => void;
  onDistribute?: () => void;
  /** Props forwarded from useSortable to make the row draggable */
  dragHandleProps?: React.HTMLAttributes<HTMLElement>;
  isDragging?: boolean;
}

export function CompactRow({
  job,
  override,
  splitTo,
  isReceived,
  sourceTrunkLine,
  onOpen,
  onSaveComment,
  onSaveHoldUp,
  onDistribute,
  dragHandleProps,
  isDragging,
}: CompactRowProps) {
  const accentColor = STATUS_ACCENT[job.status] ?? "#9ca3af";
  const flags = getJobFlags(job);
  const manyFlags = flags.length > 3;

  const packs = job.linkedFillOrders
    .filter((fo) => fo.packSize && fo.quantity)
    .map((fo) => `${fo.quantity}×${fo.packSize}`)
    .join(" · ");

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
    if (trimmed !== (currentComment ?? "")) {
      onSaveComment?.(trimmed);
    }
  }

  // Multi-pack: ≥2 distinct pack sizes → show distribute CTA
  const distinctPackSizes = new Set(
    job.linkedFillOrders.map((fo) => fo.packSize).filter(Boolean),
  );
  const hasMultiplePacks = distinctPackSizes.size >= 2;

  return (
    <li
      className={cn(
        "group grid gap-2.5 rounded-md px-1.5 py-[8px] transition",
        // 4-col when drag handle present, 3-col otherwise
        dragHandleProps
          ? "grid-cols-[16px_6px_minmax(0,1fr)_auto]"
          : "grid-cols-[6px_minmax(0,1fr)_auto]",
        isReceived && "bg-violet-50/40 dark:bg-violet-950/10",
        isDragging && "opacity-50 shadow-lg",
        onOpen && !editingComment && "cursor-pointer hover:bg-muted/40",
      )}
      role={onOpen && !editingComment ? "button" : undefined}
      tabIndex={onOpen && !editingComment ? 0 : undefined}
      onClick={onOpen && !editingComment ? onOpen : undefined}
      onKeyDown={
        onOpen && !editingComment
          ? (e) => e.key === "Enter" && onOpen()
          : undefined
      }
    >
      {/* Drag handle (only when sortable) */}
      {dragHandleProps && (
        <span
          {...dragHandleProps}
          onClick={(e) => e.stopPropagation()}
          className="flex items-center justify-center text-muted-foreground/30 transition hover:text-muted-foreground/60 cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
      )}

      {/* Left status-accent rail */}
      <span
        className="h-4 w-[2px] rounded-sm flex-shrink-0 self-center"
        style={{ backgroundColor: accentColor }}
      />

      {/* Info stack */}
      <div className="flex min-w-0 flex-col gap-0.5">
        {/* Line 1: MATERIAL · BATCH · flags (if ≤3) · PACKS */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-mono text-[11.5px] font-semibold tabular-nums text-foreground">
            {job.materialCode ?? "—"}
          </span>
          <span className="text-[10px] text-border">·</span>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {job.sapOrder}
          </span>
          {!manyFlags && <FlagWrap flags={flags} />}
          {packs && (
            <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
              {packs}
            </span>
          )}
        </div>

        {/* Line 2: flag overflow */}
        {manyFlags && (
          <div className="mt-0.5">
            <FlagWrap flags={flags} />
          </div>
        )}

        {/* Line 3: routing badges + distribute CTA */}
        {(splitTo?.length || isReceived || (hasMultiplePacks && onDistribute)) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {hasMultiplePacks && onDistribute && !splitTo?.length && (
              <button
                onClick={(e) => { e.stopPropagation(); onDistribute(); }}
                className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[9.5px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200 transition hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800"
              >
                <ArrowLeftRight className="h-2.5 w-2.5" />
                Split packs
              </button>
            )}
            {splitTo?.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-md bg-purple-50 px-1.5 py-0.5 text-[9.5px] font-semibold text-purple-700 ring-1 ring-inset ring-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:ring-purple-800"
              >
                <ArrowLeftRight className="h-2.5 w-2.5" />→ {t}
              </span>
            ))}
            {isReceived && sourceTrunkLine && (
              <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[9.5px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200 dark:bg-indigo-950 dark:text-indigo-300 dark:ring-indigo-800">
                <ArrowLeftRight className="h-2.5 w-2.5" />from {sourceTrunkLine}
              </span>
            )}
          </div>
        )}

        {/* Hold-up note display */}
        {holdUpNote && (
          <div className="mt-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[9.5px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            ⚠ {holdUpNote}
          </div>
        )}

        {/* Inline comment */}
        {onSaveComment && (
          <div onClick={(e) => e.stopPropagation()}>
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
                  "rounded px-0.5 py-0.5 text-left font-mono text-[10.5px] transition",
                  currentComment
                    ? "italic text-muted-foreground hover:bg-muted/50"
                    : "text-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:bg-muted/50",
                )}
              >
                {currentComment ?? "Add note…"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Right column: hold-up trigger + mixer chip */}
      <div className="flex flex-shrink-0 items-center gap-1">
        {onSaveHoldUp && (
          <span onClick={(e) => e.stopPropagation()}>
            <HoldUpPopover currentNote={holdUpNote} onSave={onSaveHoldUp} />
          </span>
        )}
        <span className="inline-flex justify-center rounded-md bg-muted px-1.5 py-[2px] font-mono text-[10.5px] font-semibold tabular-nums text-foreground min-w-[34px]">
          {mixerLabel}
        </span>
      </div>
    </li>
  );
}
