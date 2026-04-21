import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { format, addDays, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/ui/cn";
import { TrunkCard, TRUNK_COLORS } from "./trunk-card";
import { PackSizeDistributionModal } from "./pack-size-distribution-modal";
import { JobSelectionDrawer } from "./job-selection-drawer";
import { useFillingDayPlan } from "@/hooks/use-filling-day-plan";
import { useFillingDayPlanMeta } from "@/hooks/use-filling-day-plan-meta";
import { useBatchDayPlanOverrides, useSaveSortOrders } from "@/hooks/use-batch-day-plan-overrides";
import { useBatchTrunkAssignments } from "@/hooks/use-batch-trunk-assignments";
import type { Resource } from "@/types/resource";
import type { LinkedFillOrder } from "@/types/batch";
import type {
  FillingJob,
  FillingOverride,
  FoAssignments,
  GhostJob,
  SortMode,
  TrunkJob,
} from "./types";

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: "scheduled", label: "Scheduled" },
  { value: "active",    label: "Active first" },
  { value: "finish",    label: "Finish" },
  { value: "priority",  label: "Priority" },
];

const TRUNK_ORDER = ["TK1", "TK2", "TK3", "TK4", "TK5", "TK6"];

interface FillingDayPlanTabProps {
  resources: Resource[];
  onOpenBatch?: (id: string) => void;
}

// ── Derived view: which jobs belong to a given trunk ──────────────────────

function getJobsForTrunk(
  trunkId: string,
  jobs: FillingJob[],
  foAssignments: FoAssignments,
  overrideMap: Record<string, FillingOverride>,
): TrunkJob[] {
  const result: TrunkJob[] = [];

  for (const job of jobs) {
    const homeTrunk = job.resource?.trunkLine ?? null;

    const assignedFOs = job.linkedFillOrders.filter(
      (fo) => foAssignments[fo.id] === trunkId,
    );
    const unassignedFOs = job.linkedFillOrders.filter(
      (fo) => !foAssignments[fo.id],
    );
    const otherTrunkFOs = job.linkedFillOrders.filter(
      (fo) => foAssignments[fo.id] && foAssignments[fo.id] !== trunkId,
    );

    let displayFOs: LinkedFillOrder[];
    let isReceived: boolean;

    if (homeTrunk === trunkId) {
      displayFOs = [...new Set([...assignedFOs, ...unassignedFOs])];
      isReceived = false;
    } else if (assignedFOs.length > 0) {
      displayFOs = assignedFOs;
      isReceived = true;
    } else {
      continue;
    }

    if (displayFOs.length === 0) continue;

    const splitTo = [
      ...new Set(otherTrunkFOs.map((fo) => foAssignments[fo.id])),
    ];

    const override = overrideMap[job.id] ?? null;

    result.push({
      ...job,
      override,
      sourceTrunkLine: homeTrunk,
      displayFOs,
      splitTo,
      isReceived,
      sortOrder: override?.sortOrder ?? null,
    });
  }

  result.sort((a, b) => {
    if (a.sortOrder != null && b.sortOrder != null) return a.sortOrder - b.sortOrder;
    if (a.sortOrder != null) return -1;
    if (b.sortOrder != null) return 1;
    const p = (x: TrunkJob) => (x.ipt === 1 ? 0 : x.ipt === 2 ? 1 : 2);
    return p(a) - p(b);
  });

  return result;
}

// ── Tab component ──────────────────────────────────────────────────────────

export function FillingDayPlanTab({ resources, onOpenBatch }: FillingDayPlanTabProps) {
  const [planDate, setPlanDate] = useState(() => format(new Date(), "yyyy-MM-dd"));

  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const stored = localStorage.getItem("fpSortMode");
    return (stored as SortMode | null) ?? "scheduled";
  });

  // ── Data ─────────────────────────────────────────────────────────────────
  const { data, isLoading } = useFillingDayPlan(planDate);

  const batches = data?.batches ?? [];
  const serverOverrideMap = data?.overrideMap ?? {};
  const serverFoAssignments = data?.foAssignments ?? {};
  const meta = data?.meta ?? null;
  const ghosts = data?.ghosts ?? [];

  // Local foAssignments (optimistic)
  const [foAssignments, setFoAssignments] = useState<FoAssignments>({});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setFoAssignments(serverFoAssignments); }, [JSON.stringify(serverFoAssignments)]);

  // ── Resource lookup ───────────────────────────────────────────────────────
  const resourceMap = useMemo(
    () => new Map(resources.map((r) => [r.id, r])),
    [resources],
  );

  const jobs = useMemo<FillingJob[]>(
    () =>
      batches.map((b) => ({
        ...b,
        resource: b.planResourceId
          ? (resourceMap.get(b.planResourceId) ?? null)
          : null,
      })),
    [batches, resourceMap],
  );

  // ── Mutations ─────────────────────────────────────────────────────────────
  const metaMutation = useFillingDayPlanMeta();
  const overrideMutation = useBatchDayPlanOverrides();
  const sortOrderMutation = useSaveSortOrders();
  const trunkAssignmentMutation = useBatchTrunkAssignments();

  // ── Leader change (debounced 800ms) ────────────────────────────────────────
  const leaderMapRef = useRef<Record<string, string>>({});
  const leaderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    leaderMapRef.current = meta?.trunkLeaders ?? {};
  }, [meta]);

  const handleLeaderChange = useCallback(
    (trunk: string, name: string) => {
      leaderMapRef.current = { ...leaderMapRef.current, [trunk]: name };
      if (leaderTimerRef.current) clearTimeout(leaderTimerRef.current);
      leaderTimerRef.current = setTimeout(() => {
        metaMutation.mutate({ planDate, trunkLeaders: leaderMapRef.current });
      }, 800);
    },
    [planDate, metaMutation],
  );

  // ── Override saves ────────────────────────────────────────────────────────
  const handleSaveComment = useCallback(
    (batchId: string, comment: string) => {
      overrideMutation.mutate({ batchId, planDate, comment: comment || null });
    },
    [planDate, overrideMutation],
  );

  const handleSaveHoldUp = useCallback(
    (batchId: string, note: string | null) => {
      overrideMutation.mutate({ batchId, planDate, holdUpNote: note });
    },
    [planDate, overrideMutation],
  );

  // ── Ghost dismiss ─────────────────────────────────────────────────────────
  const handleDismissGhost = useCallback((_batchId: string) => {
    toast.info("Ghost row dismissed");
  }, []);

  // ── Drag reorder ──────────────────────────────────────────────────────────
  const handleReorder = useCallback(
    (_trunk: string, newOrderedIds: string[]) => {
      const rows = newOrderedIds.map((batchId, index) => ({
        batchId,
        planDate,
        sortOrder: index,
      }));
      sortOrderMutation.mutate(rows);
    },
    [planDate, sortOrderMutation],
  );

  // ── Distribution modal ─────────────────────────────────────────────────────
  const [distributingJob, setDistributingJob] = useState<FillingJob | null>(null);

  const handleDistributionApply = useCallback(
    (batchId: string, assignments: Array<{ trunkLine: string; fillOrderIds: string[] }>) => {
      setFoAssignments((prev) => {
        const next = { ...prev };
        for (const a of assignments) {
          for (const foId of a.fillOrderIds) {
            next[foId] = a.trunkLine;
          }
        }
        return next;
      });
      trunkAssignmentMutation.mutate(
        { batchId, planDate, assignments },
        {
          onError: (err) => {
            toast.error(err instanceof Error ? err.message : "Failed to save pack routing");
          },
        },
      );
      setDistributingJob(null);
    },
    [planDate, trunkAssignmentMutation],
  );

  // ── Job selection drawer ───────────────────────────────────────────────────
  const [addingToTrunk, setAddingToTrunk] = useState<string | null>(null);

  // ── Sort ──────────────────────────────────────────────────────────────────
  const handleSortChange = useCallback((mode: SortMode) => {
    setSortMode(mode);
    localStorage.setItem("fpSortMode", mode);
  }, []);

  // ── Derived trunk data ────────────────────────────────────────────────────
  const trunkJobsMap = useMemo(() => {
    const map = new Map<string, TrunkJob[]>();
    for (const t of TRUNK_ORDER) {
      map.set(t, getJobsForTrunk(t, jobs, foAssignments, serverOverrideMap));
    }
    // Unassigned: batches with no trunk or unrecognised trunk
    const unassigned: TrunkJob[] = jobs
      .filter((j) => {
        const t = j.resource?.trunkLine;
        return !t || !TRUNK_ORDER.includes(t);
      })
      .map((j) => ({
        ...j,
        override: serverOverrideMap[j.id] ?? null,
        displayFOs: j.linkedFillOrders,
        splitTo: [],
        isReceived: false,
        sourceTrunkLine: null,
        sortOrder: serverOverrideMap[j.id]?.sortOrder ?? null,
      }));
    if (unassigned.length > 0) map.set("Unassigned", unassigned);
    return map;
  }, [jobs, foAssignments, serverOverrideMap]);

  const ghostsByTrunk = useMemo(() => {
    const map = new Map<string, GhostJob[]>();
    for (const ghost of ghosts) {
      const t = ghost.originalTrunkLine ?? "Unassigned";
      const existing = map.get(t) ?? [];
      existing.push(ghost);
      map.set(t, existing);
    }
    return map;
  }, [ghosts]);

  const visibleTrunks = useMemo(() => {
    const hasAnyJobs = jobs.length > 0;
    const base = hasAnyJobs
      ? TRUNK_ORDER
      : TRUNK_ORDER.filter((t) => (trunkJobsMap.get(t)?.length ?? 0) > 0);
    const extra = [...trunkJobsMap.keys()].filter(
      (t) => !TRUNK_ORDER.includes(t) && (trunkJobsMap.get(t)?.length ?? 0) > 0,
    );
    return [...base, ...extra];
  }, [jobs.length, trunkJobsMap]);

  const allTrunkJobs = useMemo(() => [...trunkJobsMap.values()].flat(), [trunkJobsMap]);

  const currentBatchIds = useMemo(() => new Set(jobs.map((j) => j.id)), [jobs]);

  // ── Summary counts ────────────────────────────────────────────────────────
  const parsedDate = useMemo(() => parseISO(planDate), [planDate]);
  const dateLabel = format(parsedDate, "EEEE d MMMM yyyy");
  const totalJobs = jobs.length;
  const priorityCount = jobs.filter((j) => j.ipt != null).length;
  const holdCount = jobs.filter(
    (j) =>
      j.status === "OFF WOM" ||
      j.status === "OFF WOP" ||
      j.status === "Hold" ||
      j.status === "NCB",
  ).length;

  return (
    <div className="flex flex-col gap-3">
      {/* ── Date navigation + summary chips ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1.5">
          <button
            onClick={() =>
              setPlanDate(format(addDays(parsedDate, -1), "yyyy-MM-dd"))
            }
            className="grid h-7 w-7 place-items-center rounded-md border bg-background text-muted-foreground transition hover:bg-muted hover:text-foreground"
            title="Previous day"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setPlanDate(format(new Date(), "yyyy-MM-dd"))}
            className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1 text-[12.5px] font-semibold tabular-nums text-foreground transition hover:bg-muted"
            title="Jump to today"
          >
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            {dateLabel}
          </button>
          <button
            onClick={() =>
              setPlanDate(format(addDays(parsedDate, 1), "yyyy-MM-dd"))
            }
            className="grid h-7 w-7 place-items-center rounded-md border bg-background text-muted-foreground transition hover:bg-muted hover:text-foreground"
            title="Next day"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
            {totalJobs} job{totalJobs !== 1 ? "s" : ""}
          </span>
          {priorityCount > 0 && (
            <span className="inline-flex items-center rounded-md bg-rose-50 px-2 py-0.5 text-[10.5px] font-medium text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-800">
              ⚡ {priorityCount} priority
            </span>
          )}
          {holdCount > 0 && (
            <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[10.5px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800">
              ⚠ {holdCount} hold{holdCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* ── Sort strip ── */}
      <div className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2">
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold tracking-tight text-foreground">
            Merged hierarchy
          </div>
          <div className="mt-0.5 text-[10.5px] text-muted-foreground">
            Running job enlarged · queued jobs as one-liners · drag to reorder
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className="text-[10.5px] font-medium text-muted-foreground">Sort</span>
          <div className="inline-flex rounded-lg bg-muted p-0.5">
            {SORT_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => handleSortChange(o.value)}
                className={cn(
                  "rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium whitespace-nowrap transition",
                  sortMode === o.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Loading ── */}
      {isLoading && (
        <div className="py-12 text-center text-[13px] text-muted-foreground">
          Loading filling plan…
        </div>
      )}

      {/* ── Empty ── */}
      {!isLoading && visibleTrunks.length === 0 && (
        <div className="rounded-md border bg-card px-6 py-12 text-center">
          <p className="text-[13px] font-medium text-foreground">
            No filling jobs for {dateLabel}
          </p>
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            Batches in Ready to Fill, Filling, On Test, In Progress or hold statuses
            assigned to a mixer will appear here.
          </p>
        </div>
      )}

      {/* ── Trunk grid ── */}
      {!isLoading && visibleTrunks.length > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {visibleTrunks.map((trunk) => (
            <TrunkCard
              key={trunk}
              trunkLine={trunk}
              jobs={trunkJobsMap.get(trunk) ?? []}
              overrideMap={serverOverrideMap}
              ghosts={ghostsByTrunk.get(trunk) ?? []}
              leaderName={meta?.trunkLeaders[trunk]}
              sortMode={sortMode}
              onOpenBatch={onOpenBatch}
              onAddJob={() => setAddingToTrunk(trunk)}
              onLeaderChange={handleLeaderChange}
              onSaveComment={handleSaveComment}
              onSaveHoldUp={handleSaveHoldUp}
              onDistribute={(job) => setDistributingJob(job)}
              onDismissGhost={handleDismissGhost}
              onReorder={handleReorder}
            />
          ))}
        </div>
      )}

      {/* ── Pack-size distribution modal ── */}
      <PackSizeDistributionModal
        open={!!distributingJob}
        onOpenChange={(open) => { if (!open) setDistributingJob(null); }}
        job={distributingJob}
        allJobs={allTrunkJobs}
        currentAssignments={foAssignments}
        trunkLeaders={meta?.trunkLeaders ?? {}}
        onApply={handleDistributionApply}
      />

      {/* ── Job selection drawer ── */}
      {addingToTrunk && (
        <JobSelectionDrawer
          open
          onOpenChange={(open) => { if (!open) setAddingToTrunk(null); }}
          trunkLine={addingToTrunk}
          trunkColor={TRUNK_COLORS[addingToTrunk] ?? "#9ca3af"}
          resources={resources}
          planDate={planDate}
          currentBatchIds={currentBatchIds}
        />
      )}
    </div>
  );
}
