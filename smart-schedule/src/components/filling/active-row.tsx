import { useState, useRef } from "react";
import { ArrowLeftRight } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { FlagWrap, getJobFlags } from "./flag-pill";
import { HoldUpPopover } from "./holdup-popover";
import type { FillingJob, FillingOverride } from "./types";

export const STATUS_ACCENT: Partial<Record<string, string>> = {
  Filling:          "#059669",
  "In Progress":    "#059669",
  "Ready to Fill":  "#0891b2",
  "On Test":        "#7c3aed",
  Planned:          "#9ca3af",
  "OFF WOM":        "#d97706",
  "OFF WOP":        "#d97706",
  Hold:             "#d97706",
  NCB:              "#ef4444",
  "Job Complete":   "#6b7280",
};

interface ActiveRowProps {
  job: FillingJob;
  override?: FillingOverride | null;
  splitTo?: string[];
  isReceived?: boolean;
  sourceTrunkLine?: string | null;
  onOpen?: () => void;
  onSaveComment?: (comment: string) => void;
  onSaveHoldUp?: (note: string | null) => void;
  onDistribute?: () => void;
}

export function ActiveRow({
  job,
  override,
  splitTo,
  isReceived,
  sourceTrunkLine,
  onOpen,
  onSaveComment,
  onSaveHoldUp,
  onDistribute,
}: ActiveRowProps) {
  const accentColor = STATUS_ACCENT[job.status] ?? "#9ca3af";
  const flags = getJobFlags(job);

  const packs = job.linkedFillOrders
    .filter((fo) => fo.packSize && fo.quantity)
    .map((fo) => `${fo.quantity}×${fo.packSize}`)
    .join(" · ");

  const mixerLabel = job.resource
    ? (job.resource.displayName ?? job.resource.resourceCode)
    : "—";

  // Inline comment edit
  const [editingComment, setEditingComment] = useState(false);
  const [commentDraft, setCommentDraft] = useState(override?.comment ?? "");
  const commentRef = useRef<HTMLInputElement>(null);
  const currentComment = override?.comment ?? null;
  const holdUpNote = override?.holdUpNote ?? null;

  function handleCommentBlur() {
    setEditingComment(false);
    const trimmed = commentDraft.trim();
    if (trimmed !== (currentComment ?? "")) {
      onSaveComment?.(trimmed);
    }
  }

  // Multi-pack detect: ≥2 fill orders with different pack sizes → show distribute CTA
  const distinctPackSizes = new Set(
    job.linkedFillOrders.map((fo) => fo.packSize).filter(Boolean),
  );
  const hasMultiplePacks = distinctPackSizes.size >= 2;

  return (
    <div
      className={cn(
        "group relative rounded-md border px-3 py-2.5 transition",
        isReceived
          ? "border-violet-200 bg-violet-50/50 dark:border-violet-800 dark:bg-violet-950/20"
          : "border-border bg-muted/30 hover:border-foreground/30 hover:bg-muted/50",
        onOpen && "cursor-pointer",
      )}
      style={{ boxShadow: `inset 3px 0 0 ${accentColor}` }}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={onOpen ? (e) => e.key === "Enter" && onOpen() : undefined}
    >
      {/* Top row: BATCH · MATERIAL — MIXER + hold-up trigger */}
      <div className="flex items-baseline gap-2.5">
        <span className="font-mono text-[16px] font-bold tabular-nums tracking-tight text-foreground leading-none">
          {job.sapOrder}
        </span>
        <span className="text-[11px] text-border">·</span>
        <span className="font-mono text-[14px] font-semibold tabular-nums text-foreground leading-none">
          {job.materialCode ?? "—"}
        </span>

        <div className="ml-auto flex flex-shrink-0 items-center gap-1.5">
          {/* Hold-up popover */}
          {onSaveHoldUp && (
            <span onClick={(e) => e.stopPropagation()}>
              <HoldUpPopover
                currentNote={holdUpNote}
                onSave={onSaveHoldUp}
              />
            </span>
          )}
          <span className="inline-flex justify-center rounded-md bg-muted px-2.5 py-1 font-mono text-[13px] font-semibold tabular-nums text-foreground min-w-[52px]">
            {mixerLabel}
          </span>
        </div>
      </div>

      {/* Second row: flags + pack list + routing badges */}
      {(flags.length > 0 || packs || splitTo?.length || isReceived || hasMultiplePacks) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <FlagWrap flags={flags} />
          {packs && (
            <span className="font-mono text-[11.5px] tabular-nums text-foreground">
              {packs}
            </span>
          )}

          {/* Phase 3: distribute CTA */}
          {hasMultiplePacks && onDistribute && !splitTo?.length && (
            <button
              onClick={(e) => { e.stopPropagation(); onDistribute(); }}
              className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[9.5px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200 transition hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800"
            >
              <ArrowLeftRight className="h-2.5 w-2.5" />
              Split packs
            </button>
          )}

          {/* Split routing badges */}
          {splitTo?.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-md bg-purple-50 px-1.5 py-0.5 text-[9.5px] font-semibold text-purple-700 ring-1 ring-inset ring-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:ring-purple-800"
            >
              <ArrowLeftRight className="h-2.5 w-2.5" />
              → {t}
            </span>
          ))}

          {/* Received badge */}
          {isReceived && sourceTrunkLine && (
            <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[9.5px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200 dark:bg-indigo-950 dark:text-indigo-300 dark:ring-indigo-800">
              <ArrowLeftRight className="h-2.5 w-2.5" />
              from {sourceTrunkLine}
            </span>
          )}
        </div>
      )}

      {/* Hold-up note display */}
      {holdUpNote && (
        <div className="mt-1.5 rounded-md bg-amber-50 px-2 py-0.5 text-[10.5px] text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800">
          ⚠ {holdUpNote}
        </div>
      )}

      {/* Inline comment */}
      {onSaveComment && (
        <div
          className="mt-1.5"
          onClick={(e) => e.stopPropagation()}
        >
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
              className="w-full rounded-md border bg-background px-2 py-0.5 font-mono text-[11px] text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
            />
          ) : (
            <button
              onClick={() => {
                setCommentDraft(currentComment ?? "");
                setEditingComment(true);
              }}
              className={cn(
                "w-full rounded-md px-1 py-0.5 text-left font-mono text-[11px] transition",
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
  );
}
