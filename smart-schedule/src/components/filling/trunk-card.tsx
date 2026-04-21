import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { X } from "lucide-react";
import { format } from "date-fns";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/ui/cn";
import { ActiveRow } from "./active-row";
import { CompactRow } from "./compact-row";
import type { FillingJob, FillingOverride, GhostJob, SortMode, TrunkJob } from "./types";
import type { BatchStatus } from "@/types/batch";

const ACTIVE_STATUSES = new Set<BatchStatus>([
  "Filling",
  "In Progress",
  "OFF WOM",
  "OFF WOP",
]);

export const TRUNK_COLORS: Record<string, string> = {
  TK1: "#3B82F6",
  TK2: "#10B981",
  TK3: "#F59E0B",
  TK4: "#EF4444",
  TK5: "#8B5CF6",
  TK6: "#EC4899",
};

function sortJobs(jobs: TrunkJob[], mode: SortMode): TrunkJob[] {
  const arr = [...jobs];
  if (mode === "active") {
    arr.sort((a, b) => {
      const aA = ACTIVE_STATUSES.has(a.status) ? 0 : 1;
      const bA = ACTIVE_STATUSES.has(b.status) ? 0 : 1;
      return aA - bA;
    });
  } else if (mode === "priority") {
    arr.sort((a, b) => (a.ipt ?? 9) - (b.ipt ?? 9));
  }
  return arr;
}

// Sortable list item wrapper
function SortableJobItem({
  job,
  override,
  isActive: _isActive,
  forceActiveTop,
  runningJob,
  onOpenBatch,
  onSaveComment,
  onSaveHoldUp,
  onDistribute,
}: {
  job: TrunkJob;
  override?: FillingOverride | null;
  isActive: boolean;
  forceActiveTop: boolean;
  runningJob: TrunkJob | null;
  onOpenBatch?: (id: string) => void;
  onSaveComment?: (batchId: string, comment: string) => void;
  onSaveHoldUp?: (batchId: string, note: string | null) => void;
  onDistribute?: (job: FillingJob) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: job.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  if (job === runningJob && !forceActiveTop) {
    return (
      <li key={job.id} className="py-1" ref={setNodeRef} style={style}>
        <ActiveRow
          job={job}
          override={override}
          splitTo={job.splitTo}
          isReceived={job.isReceived}
          sourceTrunkLine={job.sourceTrunkLine}
          onOpen={onOpenBatch ? () => onOpenBatch(job.id) : undefined}
          onSaveComment={onSaveComment ? (c) => onSaveComment(job.id, c) : undefined}
          onSaveHoldUp={onSaveHoldUp ? (n) => onSaveHoldUp(job.id, n) : undefined}
          onDistribute={onDistribute ? () => onDistribute(job) : undefined}
        />
      </li>
    );
  }

  return (
    <CompactRow
      key={job.id}
      job={job}
      override={override}
      splitTo={job.splitTo}
      isReceived={job.isReceived}
      sourceTrunkLine={job.sourceTrunkLine}
      onOpen={onOpenBatch ? () => onOpenBatch(job.id) : undefined}
      onSaveComment={onSaveComment ? (c) => onSaveComment(job.id, c) : undefined}
      onSaveHoldUp={onSaveHoldUp ? (n) => onSaveHoldUp(job.id, n) : undefined}
      onDistribute={onDistribute ? () => onDistribute(job) : undefined}
      dragHandleProps={{ ...attributes, ...listeners }}
      isDragging={isDragging}
    />
  );
}

interface TrunkCardProps {
  trunkLine: string;
  jobs: TrunkJob[];
  overrideMap?: Record<string, FillingOverride>;
  ghosts?: GhostJob[];
  leaderName?: string;
  sortMode: SortMode;
  onOpenBatch?: (id: string) => void;
  onAddJob?: () => void;
  onLeaderChange?: (trunkLine: string, name: string) => void;
  onSaveComment?: (batchId: string, comment: string) => void;
  onSaveHoldUp?: (batchId: string, note: string | null) => void;
  onDistribute?: (job: FillingJob) => void;
  onDismissGhost?: (batchId: string) => void;
  onReorder?: (trunkLine: string, newOrderedIds: string[]) => void;
}

export function TrunkCard({
  trunkLine,
  jobs,
  overrideMap = {},
  ghosts = [],
  leaderName,
  sortMode,
  onOpenBatch,
  onAddJob,
  onLeaderChange,
  onSaveComment,
  onSaveHoldUp,
  onDistribute,
  onDismissGhost,
  onReorder,
}: TrunkCardProps) {
  const color = TRUNK_COLORS[trunkLine] ?? "#9ca3af";
  const trunkNumber = trunkLine.replace("TK", "");
  const badgeLabel = trunkLine.replace("TK", "T");

  // ── Leader input (debounced) ──────────────────────────────────────────────
  const [leaderDraft, setLeaderDraft] = useState(leaderName ?? "");
  const leaderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLeaderDraft(leaderName ?? "");
  }, [leaderName]);

  const handleLeaderChange = useCallback(
    (value: string) => {
      setLeaderDraft(value);
      if (leaderTimer.current) clearTimeout(leaderTimer.current);
      leaderTimer.current = setTimeout(() => {
        onLeaderChange?.(trunkLine, value);
      }, 800);
    },
    [trunkLine, onLeaderChange],
  );

  // ── Sort ──────────────────────────────────────────────────────────────────
  const sortedJobs = useMemo(() => sortJobs(jobs, sortMode), [jobs, sortMode]);

  // ── Local order for drag-to-reorder ──────────────────────────────────────
  const [localOrder, setLocalOrder] = useState<string[]>(() =>
    sortedJobs.map((j) => j.id),
  );

  useEffect(() => {
    setLocalOrder(sortedJobs.map((j) => j.id));
  }, [sortedJobs.map((j) => j.id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const orderedJobs = useMemo(() => {
    if (!onReorder) return sortedJobs;
    const byId = new Map(sortedJobs.map((j) => [j.id, j]));
    return localOrder.map((id) => byId.get(id)).filter(Boolean) as TrunkJob[];
  }, [localOrder, sortedJobs, onReorder]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localOrder.indexOf(active.id as string);
    const newIndex = localOrder.indexOf(over.id as string);
    const newOrder = arrayMove(localOrder, oldIndex, newIndex);
    setLocalOrder(newOrder);
    onReorder?.(trunkLine, newOrder);
  }

  // ── Active / running detection ────────────────────────────────────────────
  const forceActiveTop = sortMode === "active";
  const activeJob = forceActiveTop
    ? orderedJobs.find((j) => ACTIVE_STATUSES.has(j.status)) ?? null
    : null;
  const runningJob = orderedJobs.find((j) => ACTIVE_STATUSES.has(j.status)) ?? null;

  const compactJobs = forceActiveTop
    ? orderedJobs.filter((j) => j !== activeJob)
    : orderedJobs;

  // ── Progress bar ──────────────────────────────────────────────────────────
  const progress = useMemo(() => {
    if (jobs.length === 0) return 0;
    const done = jobs.filter(
      (j) =>
        j.status === "Job Complete" ||
        j.status === "Filling" ||
        j.status === "In Progress",
    ).length;
    return done / jobs.length;
  }, [jobs]);

  const jobIds = orderedJobs.map((j) => j.id);

  return (
    <section
      className={cn(
        "flex flex-col overflow-hidden rounded-[var(--radius-card)] border bg-card text-card-foreground",
        "shadow-[var(--shadow-card)]",
      )}
    >
      {/* ── Trunk header ── */}
      <div
        className="flex items-center gap-2.5 border-b px-3 py-2.5"
        style={{ boxShadow: `inset 3px 0 0 ${color}` }}
      >
        {/* Coloured badge */}
        <div
          className="grid flex-shrink-0 place-items-center rounded-[6px] font-bold text-white"
          style={{ backgroundColor: color, width: 32, height: 32, fontSize: 13 }}
        >
          {badgeLabel}
        </div>

        {/* Name + editable leader */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[13px] font-semibold tracking-tight text-foreground">
              Trunk {trunkNumber}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            {onLeaderChange ? (
              <input
                type="text"
                value={leaderDraft}
                onChange={(e) => handleLeaderChange(e.target.value)}
                placeholder="Team leader"
                className="min-w-0 flex-1 bg-transparent text-[10.5px] text-muted-foreground placeholder:text-muted-foreground/40 focus:text-foreground focus:outline-none"
              />
            ) : (
              leaderName && (
                <span className="text-[10.5px] text-muted-foreground">{leaderName}</span>
              )
            )}
          </div>
          {/* Job count */}
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground">
            <span className="text-border">→</span>
            <span className="font-semibold text-foreground text-[11px]">
              {jobs.length} job{jobs.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </div>

      {/* ── Progress bar ── */}
      <div className="px-3 pb-0.5 pt-1.5">
        <div className="h-[3px] w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-foreground/75 transition-all"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>

      {/* ── Job list ── */}
      <div className="flex flex-1 flex-col gap-1 px-2 pb-1 pt-1.5">
        {orderedJobs.length === 0 && ghosts.length === 0 && (
          <p className="px-2 py-3 text-[11px] italic text-muted-foreground">
            No jobs
          </p>
        )}

        {/* Active-first: enlarged row pinned to top */}
        {forceActiveTop && activeJob && (
          <ActiveRow
            job={activeJob}
            override={overrideMap[activeJob.id]}
            splitTo={activeJob.splitTo}
            isReceived={activeJob.isReceived}
            sourceTrunkLine={activeJob.sourceTrunkLine}
            onOpen={onOpenBatch ? () => onOpenBatch(activeJob.id) : undefined}
            onSaveComment={onSaveComment ? (c) => onSaveComment(activeJob.id, c) : undefined}
            onSaveHoldUp={onSaveHoldUp ? (n) => onSaveHoldUp(activeJob.id, n) : undefined}
            onDistribute={onDistribute ? () => onDistribute(activeJob) : undefined}
          />
        )}

        {/* Sortable job list */}
        {compactJobs.length > 0 && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={jobIds} strategy={verticalListSortingStrategy}>
              <ul className="flex flex-col divide-y">
                {compactJobs.map((j) => (
                  <SortableJobItem
                    key={j.id}
                    job={j}
                    override={overrideMap[j.id]}
                    isActive={ACTIVE_STATUSES.has(j.status)}
                    forceActiveTop={forceActiveTop}
                    runningJob={runningJob}
                    onOpenBatch={onOpenBatch}
                    onSaveComment={onSaveComment}
                    onSaveHoldUp={onSaveHoldUp}
                    onDistribute={onDistribute}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}

        {/* Ghost rows (batches moved away from this date) */}
        {ghosts.length > 0 && (
          <div className="mt-1 flex flex-col gap-0.5 border-t pt-1">
            {ghosts.map((ghost) => (
              <div
                key={ghost.batchId}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 text-muted-foreground/60"
              >
                <span className="font-mono text-[10.5px] tabular-nums line-through">
                  {ghost.sapOrder}
                </span>
                {ghost.movedToPlanDate && (
                  <span className="text-[10px]">
                    → {format(new Date(ghost.movedToPlanDate + "T00:00:00"), "d MMM")}
                  </span>
                )}
                <span className="ml-auto flex-shrink-0">
                  {onDismissGhost && (
                    <button
                      onClick={() => onDismissGhost(ghost.batchId)}
                      className="grid h-4 w-4 place-items-center rounded text-muted-foreground/40 transition hover:bg-muted hover:text-foreground"
                      title="Dismiss"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Add job footer ── */}
      <div className="mt-auto border-t px-3 py-1.5">
        <button
          onClick={onAddJob}
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border bg-transparent px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground transition hover:border-solid hover:border-foreground/40 hover:bg-muted/60 hover:text-foreground"
        >
          <svg
            viewBox="0 0 24 24"
            width="11"
            height="11"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add job
        </button>
      </div>
    </section>
  );
}
