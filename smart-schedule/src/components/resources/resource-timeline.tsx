import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { format, addDays, isToday, isWeekend } from "date-fns";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/ui/cn";
import { Search, X, BarChart2, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { ResourceLane, type DropTarget } from "./resource-lane";
import { GroupedPotLane } from "./grouped-pot-lane";
import { PlacementOverlay } from "./placement-overlay";
import { CapacityOverviewWall } from "./capacity-overview-wall";
import { RescheduleDialog } from "./reschedule-dialog";
import { MoveReasonModal } from "@/components/shared/move-reason-modal";
import { useUpdateBatch, useAddAuditEntry } from "@/hooks/use-batch-mutations";
import { useRecordMovement, useMovementDirections } from "@/hooks/use-schedule-movements";
import { usePermissions } from "@/hooks/use-permissions";
import { useCurrentSite } from "@/hooks/use-current-site";
import { useScheduleRules, useSubstitutionRules } from "@/hooks/use-rules";
import { useColourGroups, useColourTransitions } from "@/hooks/use-colour-groups";
import { evaluateDropTarget } from "@/lib/utils/rule-evaluator";
import type { Batch, CoverageLevel } from "@/types/batch";
import type { Resource } from "@/types/resource";
import type { ResourceBlock } from "@/types/site";
import type { DayBlock } from "@/hooks/use-day-blocks";
import { useSpotlight } from "@/contexts/spotlight-context";
import { useBatchesCoverage } from "@/hooks/use-batch-coverage";
import { useBatchLidFlags } from "@/hooks/use-batch-lid-flags";
import { useAlertsByBatch } from "@/hooks/use-alerts";


type ResourceTab = "mixers" | "dispersers" | "all";

interface PotGroup {
  name: string;
  resources: Resource[];
  resourceIds: Set<string>;
}

const POT_GROUP_ORDER = ["SB Pot", "WB Pot", "SS Pot"];

function getPotGroupKey(resource: Resource): string {
  const code = resource.resourceCode.toUpperCase();
  if (code.startsWith("SBPOT")) return "SB Pot";
  if (code.startsWith("WBPOT")) return "WB Pot";
  if (code.startsWith("SSPOT")) return "SS Pot";
  // Fallback: try display name
  const name = (resource.displayName ?? "").toUpperCase();
  if (name.startsWith("SB")) return "SB Pot";
  if (name.startsWith("WB")) return "WB Pot";
  if (name.startsWith("SS")) return "SS Pot";
  return resource.groupName ?? "Other Pot";
}

interface ResourceTimelineProps {
  batches: Batch[];
  resources: Resource[];
  blocks: ResourceBlock[];
  dayBlocks?: DayBlock[];
  weekStart: Date;
  weekEnding: Date;
  extendedStart?: Date;
  extendedEnd?: Date;
  isLoading: boolean;
  isThisWeek?: boolean;
  onBatchClick?: (batch: Batch) => void;
}

function getWeekDates(weekStart: Date, weekEnding: Date): string[] {
  const dates: string[] = [];
  let current = new Date(weekStart);
  const end = new Date(weekEnding);

  while (current <= end) {
    if (!isWeekend(current)) {
      dates.push(format(current, "yyyy-MM-dd"));
    }
    current = addDays(current, 1);
  }
  return dates;
}

/** Extended 7-day view: previous Friday + Mon-Fri + next Monday */
function getExtendedWeekDates(
  extendedStart: Date,
  extendedEnd: Date,
): string[] {
  const dates: string[] = [];
  let current = new Date(extendedStart);
  const end = new Date(extendedEnd);

  while (current <= end) {
    if (!isWeekend(current)) {
      dates.push(format(current, "yyyy-MM-dd"));
    }
    current = addDays(current, 1);
  }
  return dates;
}

export function ResourceTimeline({
  batches,
  resources,
  blocks,
  dayBlocks = [],
  weekStart,
  weekEnding,
  extendedStart,
  extendedEnd,
  isLoading,
  isThisWeek = false,
  onBatchClick,
}: ResourceTimelineProps) {
  const [tab, setTab] = useState<ResourceTab>("mixers");
  const [search, setSearch] = useState("");
  const [showCapacity, setShowCapacity] = useState(true);

  // Drag-and-drop state
  const [draggedBatch, setDraggedBatch] = useState<Batch | null>(null);
  const [moveModal, setMoveModal] = useState<{
    batch: Batch;
    targetResourceId: string;
    targetDate: string;
  } | null>(null);

  // Placement overlay state (Move button flow)
  const [movingBatch, setMovingBatch] = useState<Batch | null>(null);

  // Reschedule dialog state (WOM/WOP batches)
  const [reschedulingBatch, setReschedulingBatch] = useState<Batch | null>(null);

  const updateBatch = useUpdateBatch();
  const addAudit = useAddAuditEntry();
  const recordMovement = useRecordMovement();
  const { hasPermission } = usePermissions();
  const { user } = useCurrentSite();

  // Schedule rules & colour data for drag-drop validation + scoring
  const { data: scheduleRules = [] } = useScheduleRules();
  const { data: colourGroups = [] } = useColourGroups();
  const { data: colourTransitions = [] } = useColourTransitions();
  const { data: substitutionRules = [] } = useSubstitutionRules();
  const enabledRules = useMemo(
    () => scheduleRules.filter((r) => r.enabled),
    [scheduleRules],
  );

  const canSchedule = hasPermission("batches.schedule");

  // Coverage levels for batch card pills
  const batchIds = useMemo(() => batches.map((b) => b.id), [batches]);
  const { data: coverageMap } = useBatchesCoverage(batchIds);
  const coverageLevels = useMemo(() => {
    const levels = new Map<string, CoverageLevel>();
    if (!coverageMap) return levels;
    for (const [batchId, items] of coverageMap) {
      if (items.length > 0 && items[0]!.level !== "Good") {
        levels.set(batchId, items[0]!.level);
      }
    }
    return levels;
  }, [coverageMap]);

  // Lid type flags (red lid / blue lid) for batch card pills
  const lidFlags = useBatchLidFlags(batchIds);

  // Active bulk alert batch IDs for caution icon on cards
  const alertMap = useAlertsByBatch(batches);
  const alertBatchIds = useMemo(() => new Set(alertMap.keys()), [alertMap]);

  // Movement directions — fetched for every viewed week
  const weekStartStr = useMemo(() => format(weekStart, "yyyy-MM-dd"), [weekStart]);
  const weekEndingStr = useMemo(() => format(weekEnding, "yyyy-MM-dd"), [weekEnding]);
  const { data: movementDirections } = useMovementDirections({
    weekStart: weekStartStr,
    weekEnding: weekEndingStr,
  });

  // Production role users must always provide a reason for any move
  const requiresReasonForAllMoves =
    hasPermission("batches.schedule") &&
    !hasPermission("planning.vet") &&
    !hasPermission("planning.import");

  /**
   * Determines if a date-change move requires a comment.
   * Comments are required when:
   *  1. The move is within the current production week (isThisWeek), OR
   *  2. The move crosses a week boundary on fringe days
   *     (e.g. Monday pulled into previous Friday, or Friday pushed into next Monday)
   * Moves entirely outside the current production week do NOT require a comment.
   */
  const isMoveCommentRequired = useCallback(
    (oldDate: string, newDate: string): boolean => {
      // Production role always requires a reason
      if (requiresReasonForAllMoves) return true;

      const oldInWeek = oldDate >= weekStartStr && oldDate <= weekEndingStr;
      const newInWeek = newDate >= weekStartStr && newDate <= weekEndingStr;

      // If the move is entirely within the current week, require comment
      if (isThisWeek && oldInWeek && newInWeek) return true;

      // Fringe day detection: one date inside core week, the other outside
      // e.g. Monday → previous Friday, or Friday → next Monday
      if (oldInWeek !== newInWeek) return true;

      // Move is entirely outside the current production week — no comment needed
      return false;
    },
    [requiresReasonForAllMoves, isThisWeek, weekStartStr, weekEndingStr],
  );

  // Spotlight context (for navigating to a specific batch from health issues)
  const { spotlight, clearSpotlight } = useSpotlight();
  const spotlightBatchId = spotlight.active ? spotlight.batchId : null;
  const spotlightTargetResourceId = spotlight.active ? spotlight.targetResourceId : null;
  const timelineRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to spotlighted batch and clear after delay
  useEffect(() => {
    if (!spotlightBatchId) return;
    // Wait a tick for render
    const raf = requestAnimationFrame(() => {
      const el = timelineRef.current?.querySelector(
        `[data-batch-id="${spotlightBatchId}"]`,
      );
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
    // Auto-clear spotlight after 5s
    const timer = setTimeout(() => clearSpotlight(), 5000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [spotlightBatchId, clearSpotlight]);

  const coreDates = useMemo(
    () => getWeekDates(weekStart, weekEnding),
    [weekStart, weekEnding],
  );
  const coreDateSet = useMemo(() => new Set(coreDates), [coreDates]);

  // Build visible dates.
  // Core-week blocked days (public holidays) are kept visible so users can see
  // them on the schedule. Bookend days (prev Friday / next Monday) that are
  // blocked are replaced with the next available working day.
  const dates = useMemo(() => {
    const initialDates =
      extendedStart && extendedEnd
        ? getExtendedWeekDates(extendedStart, extendedEnd)
        : coreDates;

    if (dayBlocks.length === 0) return initialDates;

    const blockedDateSet = new Set(dayBlocks.map((db) => db.blockDate));
    const hasBlockedDates = initialDates.some((d) => blockedDateSet.has(d));
    if (!hasBlockedDates) return initialDates;

    const result: string[] = [];
    const usedDates = new Set<string>(initialDates);

    for (const dateStr of initialDates) {
      const isCore = coreDateSet.has(dateStr);
      if (isCore) {
        // Core dates: always keep, even if blocked (shown as non-working)
        result.push(dateStr);
      } else if (!blockedDateSet.has(dateStr)) {
        // Bookend date that is not blocked: keep it
        result.push(dateStr);
      } else {
        // Blocked bookend: replace with next available working day
        const isBeforeCore = dateStr < (coreDates[0] ?? dateStr);
        let candidate = addDays(new Date(dateStr + "T12:00:00"), isBeforeCore ? -1 : 1);
        for (let i = 0; i < 21; i++) {
          const candidateStr = format(candidate, "yyyy-MM-dd");
          if (
            !isWeekend(candidate) &&
            !blockedDateSet.has(candidateStr) &&
            !usedDates.has(candidateStr)
          ) {
            result.push(candidateStr);
            usedDates.add(candidateStr);
            break;
          }
          candidate = addDays(candidate, isBeforeCore ? -1 : 1);
        }
      }
    }

    // Keep chronological order
    result.sort();
    return result;
  }, [extendedStart, extendedEnd, coreDates, coreDateSet, dayBlocks]);

  // Bookend dates = dates outside the core Mon-Fri range (prev Friday, next Monday)
  const bookendDates = useMemo(
    () => new Set(dates.filter((d) => !coreDateSet.has(d))),
    [dates, coreDateSet],
  );

  // Filter resources by tab (mixers tab excludes pots — they render as grouped lanes)
  const filteredResources = useMemo(() => {
    switch (tab) {
      case "mixers":
        return resources.filter((r) => r.resourceType === "mixer");
      case "dispersers":
        return resources.filter((r) => r.resourceType === "disperser");
      case "all":
        return resources;
    }
  }, [resources, tab]);

  // Pot groups: shown as collapsed rows in the mixer view
  const potGroups = useMemo((): PotGroup[] => {
    if (tab !== "mixers") return [];
    const pots = resources.filter((r) => r.resourceType === "pot");
    if (pots.length === 0) return [];

    const groups = new Map<string, Resource[]>();
    for (const pot of pots) {
      const key = getPotGroupKey(pot);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(pot);
    }

    return Array.from(groups.entries())
      .sort(([a], [b]) => {
        const ai = POT_GROUP_ORDER.indexOf(a);
        const bi = POT_GROUP_ORDER.indexOf(b);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      })
      .map(([name, res]) => ({
        name,
        resources: res,
        resourceIds: new Set(res.map((r) => r.id)),
      }));
  }, [resources, tab]);

  // Interleaved lane order: mixers and pot groups sorted together by sort_order
  // Each pot group uses the minimum sort_order of its member resources for positioning
  const sortedLanes = useMemo((): Array<{ type: "mixer"; resource: Resource } | { type: "pot_group"; group: PotGroup }> => {
    if (tab !== "mixers") return filteredResources.map((r) => ({ type: "mixer" as const, resource: r }));

    const lanes: Array<{ type: "mixer"; resource: Resource; sortOrder: number } | { type: "pot_group"; group: PotGroup; sortOrder: number }> = [];

    for (const resource of filteredResources) {
      lanes.push({ type: "mixer", resource, sortOrder: resource.sortOrder ?? 999 });
    }

    for (const group of potGroups) {
      const minSort = Math.min(...group.resources.map((r) => r.sortOrder ?? 999));
      lanes.push({ type: "pot_group", group, sortOrder: minSort });
    }

    lanes.sort((a, b) => a.sortOrder - b.sortOrder);
    return lanes;
  }, [tab, filteredResources, potGroups]);

  // All visible resources: includes pots when on mixer tab (for drop targets, completion stats)
  const allVisibleResources = useMemo(() => {
    if (tab === "mixers" && potGroups.length > 0) {
      const potResources = potGroups.flatMap((g) => g.resources);
      return [...filteredResources, ...potResources];
    }
    return filteredResources;
  }, [tab, filteredResources, potGroups]);

  // Find the "Straight Mixes" disperser resource (code MIX) for batches with no disperser
  const straightMixResource = useMemo(
    () => resources.find((r) => r.resourceType === "disperser" && r.resourceCode === "MIX"),
    [resources],
  );

  // Group batches by resource (including disperser assignments)
  const batchesByResource = useMemo(() => {
    const map = new Map<string, Batch[]>();
    for (const r of allVisibleResources) {
      map.set(r.id, []);
    }
    for (const batch of batches) {
      // Primary resource (mixer/pot)
      if (batch.planResourceId && map.has(batch.planResourceId)) {
        map.get(batch.planResourceId)!.push(batch);
      }
      // Disperser resource (separate column, may overlap with a different resource type)
      if (batch.planDisperserId && map.has(batch.planDisperserId) && batch.planDisperserId !== batch.planResourceId) {
        map.get(batch.planDisperserId)!.push(batch);
      }
      // No disperser assigned → show under "Straight Mixes" (MIX) on disperser tab
      if (!batch.planDisperserId && straightMixResource && map.has(straightMixResource.id)) {
        map.get(straightMixResource.id)!.push(batch);
      }
      // Second disperser stage
      if (batch.planDisperser2Id && map.has(batch.planDisperser2Id) && batch.planDisperser2Id !== batch.planResourceId && batch.planDisperser2Id !== batch.planDisperserId) {
        map.get(batch.planDisperser2Id)!.push(batch);
      }
    }
    return map;
  }, [batches, allVisibleResources, straightMixResource]);

  // Batches grouped by pot group (for grouped pot lanes)
  const batchesByPotGroup = useMemo(() => {
    const map = new Map<string, Batch[]>();
    for (const group of potGroups) {
      const groupBatches: Batch[] = [];
      for (const batch of batches) {
        if (batch.planResourceId && group.resourceIds.has(batch.planResourceId)) {
          groupBatches.push(batch);
        }
      }
      map.set(group.name, groupBatches);
    }
    return map;
  }, [batches, potGroups]);

  // Blocked dates set for quick lookup (resource-level blocks)
  const blockedSet = useMemo(() => {
    const set = new Set<string>();
    for (const block of blocks) {
      let current = new Date(block.startDate + "T12:00:00");
      const end = new Date(block.endDate + "T12:00:00");
      while (current <= end) {
        const dateStr = format(current, "yyyy-MM-dd");
        set.add(`${block.resourceId}:${dateStr}`);
        current = addDays(current, 1);
      }
    }
    return set;
  }, [blocks]);

  // Day-level blocks (entire day blocked for the site) — map date → reason
  const dayBlockedMap = useMemo(
    () => new Map(dayBlocks.map((db) => [db.blockDate, db.reason])),
    [dayBlocks],
  );
  // Set for quick membership checks (drop validation etc.)
  const dayBlockedSet = useMemo(
    () => new Set(dayBlockedMap.keys()),
    [dayBlockedMap],
  );

  // Compute drop targets for all cells when a batch is being dragged
  const dropTargets = useMemo(() => {
    if (!draggedBatch) return new Map<string, DropTarget>();

    const targets = new Map<string, DropTarget>();
    for (const resource of allVisibleResources) {
      for (const date of dates) {
        const key = `${resource.id}:${date}`;

        // Same cell — not a valid target
        if (
          draggedBatch.planResourceId === resource.id &&
          draggedBatch.planDate === date
        ) {
          continue;
        }

        // Blocked by resource block or day block — always invalid
        if (blockedSet.has(key) || dayBlockedSet.has(date)) {
          targets.set(key, { resourceId: resource.id, date, valid: false });
          continue;
        }

        // Get batches already on this resource+date (excluding the dragged batch)
        const cellBatches = (batchesByResource.get(resource.id) ?? []).filter(
          (b) => b.planDate === date && b.id !== draggedBatch.id,
        );

        // Evaluate using schedule rules
        const evalResult = evaluateDropTarget({
          batch: draggedBatch,
          targetResource: resource,
          targetDate: date,
          existingBatches: cellBatches,
          rules: enabledRules,
          colourGroups,
          colourTransitions,
          substitutionRules,
        });

        targets.set(key, {
          resourceId: resource.id,
          date,
          valid: evalResult.valid,
          warning: evalResult.warnings.length > 0
            ? evalResult.warnings.join("; ")
            : undefined,
        });
      }
    }
    return targets;
  }, [draggedBatch, allVisibleResources, dates, blockedSet, dayBlockedSet, batchesByResource, enabledRules, colourGroups, colourTransitions, substitutionRules]);

  // Completion stats per date (only visible resources)
  const completionByDate = useMemo(() => {
    const visibleIds = new Set(allVisibleResources.map((r) => r.id));
    const map = new Map<string, { total: number; completed: number }>();
    for (const date of dates) {
      map.set(date, { total: 0, completed: 0 });
    }
    for (const batch of batches) {
      if (
        batch.planDate &&
        map.has(batch.planDate) &&
        batch.planResourceId &&
        visibleIds.has(batch.planResourceId)
      ) {
        const s = map.get(batch.planDate)!;
        s.total++;
        if (batch.status === "Job Complete") s.completed++;
      }
    }
    return map;
  }, [batches, dates, allVisibleResources]);

  // Highlighted batch IDs from search
  const highlightedBatchIds = useMemo(() => {
    if (!search.trim()) return new Set<string>();
    const term = search.toLowerCase();
    const ids = new Set<string>();
    for (const batch of batches) {
      if (
        batch.sapOrder.toLowerCase().includes(term) ||
        (batch.materialDescription?.toLowerCase().includes(term) ?? false) ||
        (batch.materialCode?.toLowerCase().includes(term) ?? false) ||
        (batch.bulkCode?.toLowerCase().includes(term) ?? false)
      ) {
        ids.add(batch.id);
      }
    }
    return ids;
  }, [batches, search]);

  const searchMatchCount = highlightedBatchIds.size;

  // Drag handlers
  const handleDragStart = useCallback((batch: Batch) => {
    setDraggedBatch(batch);
    // Cancel any active overlay
    setMovingBatch(null);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedBatch(null);
  }, []);

  const handleDrop = useCallback(
    (targetResourceId: string, targetDate: string) => {
      if (!draggedBatch) return;

      const dateChanged = draggedBatch.planDate !== targetDate;
      const resourceChanged = draggedBatch.planResourceId !== targetResourceId;

      if (!dateChanged && !resourceChanged) {
        setDraggedBatch(null);
        return;
      }

      // Validate scheduling rules BEFORE showing the reason modal — rules must
      // block the move regardless of whether a reason is required.
      if (resourceChanged) {
        const newResource = resources.find((r) => r.id === targetResourceId);
        if (newResource) {
          const cellBatches = (batchesByResource.get(targetResourceId) ?? []).filter(
            (b) => b.planDate === targetDate && b.id !== draggedBatch.id,
          );
          const evalResult = evaluateDropTarget({
            batch: draggedBatch,
            targetResource: newResource,
            targetDate,
            existingBatches: cellBatches,
            rules: enabledRules,
            colourGroups,
            colourTransitions,
            substitutionRules,
          });
          if (!evalResult.valid) {
            toast.error(`Move blocked: ${evalResult.warnings.join("; ")}`);
            setDraggedBatch(null);
            return;
          }
        }
      }

      // Require a reason if: Production role (all moves), or date changed and
      // the move is within the current week / crosses a week boundary (fringe days)
      const needsComment = dateChanged
        ? isMoveCommentRequired(draggedBatch.planDate!, targetDate)
        : requiresReasonForAllMoves;

      if (needsComment) {
        setMoveModal({
          batch: draggedBatch,
          targetResourceId,
          targetDate,
        });
        setDraggedBatch(null);
        return;
      }

      // No comment needed — execute directly
      executeBatchMove(draggedBatch, targetResourceId, targetDate);
      setDraggedBatch(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draggedBatch, requiresReasonForAllMoves, isMoveCommentRequired, resources, batchesByResource, enabledRules, colourGroups, colourTransitions, substitutionRules],
  );

  const executeBatchMove = useCallback(
    (batch: Batch, targetResourceId: string, targetDate: string, reason?: string) => {
      const oldResource = resources.find((r) => r.id === batch.planResourceId);
      const newResource = resources.find((r) => r.id === targetResourceId);

      // Re-validate scheduling rules before executing the move.
      // This catches moves from all paths (drag, move button, reschedule).
      if (newResource && batch.planResourceId !== targetResourceId) {
        const cellBatches = (batchesByResource.get(targetResourceId) ?? []).filter(
          (b) => b.planDate === targetDate && b.id !== batch.id,
        );
        const evalResult = evaluateDropTarget({
          batch,
          targetResource: newResource,
          targetDate,
          existingBatches: cellBatches,
          rules: enabledRules,
          colourGroups,
          colourTransitions,
          substitutionRules,
        });
        if (!evalResult.valid) {
          toast.error(`Move blocked: ${evalResult.warnings.join("; ")}`);
          return;
        }
      }

      updateBatch.mutate(
        {
          batchId: batch.id,
          updates: {
            planResourceId: targetResourceId,
            planDate: targetDate,
            planDisperserId: batch.planDisperserId,
            planDisperser2Id: batch.planDisperser2Id,
          },
        },
        {
          onSuccess: () => {
            const dateChanged = batch.planDate !== targetDate;
            const direction =
              dateChanged && targetDate < (batch.planDate ?? "")
                ? "pulled_forward"
                : dateChanged
                  ? "pushed_out"
                  : "resource_change";

            const disperser1 = batch.planDisperserId
              ? resources.find((r) => r.id === batch.planDisperserId)
              : null;
            const disperser2 = batch.planDisperser2Id
              ? resources.find((r) => r.id === batch.planDisperser2Id)
              : null;

            addAudit.mutate({
              batchId: batch.id,
              action: "batch_move",
              details: {
                from_date: batch.planDate,
                to_date: targetDate,
                from_resource: oldResource?.resourceCode ?? batch.planResourceId,
                to_resource: newResource?.resourceCode ?? targetResourceId,
                disperser1: disperser1?.resourceCode ?? batch.planDisperserId ?? null,
                disperser2: disperser2?.resourceCode ?? batch.planDisperser2Id ?? null,
                direction,
                reason: reason ?? null,
                moved_by: user?.email ?? user?.id ?? "unknown",
              },
            });

            // Record in schedule_movements table
            const movementDirection: "pulled" | "pushed" | "moved" =
              dateChanged && targetDate < (batch.planDate ?? "")
                ? "pulled"
                : dateChanged
                  ? "pushed"
                  : "moved";

            recordMovement.mutate({
              batchId: batch.id,
              fromResourceId: batch.planResourceId,
              toResourceId: targetResourceId,
              fromDate: batch.planDate,
              toDate: targetDate,
              direction: movementDirection,
              reason: reason ?? null,
              disperser1Id: batch.planDisperserId,
              disperser2Id: batch.planDisperser2Id,
            });

            toast.success(
              `Moved ${batch.sapOrder} to ${newResource?.displayName ?? newResource?.resourceCode ?? "resource"} on ${targetDate}`,
            );
          },
          onError: (err) => {
            toast.error(
              err instanceof Error ? err.message : "Failed to move batch",
            );
          },
        },
      );
    },
    [resources, updateBatch, addAudit, recordMovement, user, batchesByResource, enabledRules, colourGroups, colourTransitions, substitutionRules],
  );

  const handleMoveConfirm = useCallback(
    (reason: string) => {
      if (!moveModal) return;
      executeBatchMove(
        moveModal.batch,
        moveModal.targetResourceId,
        moveModal.targetDate,
        reason,
      );
      setMoveModal(null);
    },
    [moveModal, executeBatchMove],
  );

  // Placement overlay: triggered by Move button on BatchCard
  const handleMoveStart = useCallback(
    (batch: Batch) => {
      if (!canSchedule) return;
      setMovingBatch(batch);
      // Cancel any drag
      setDraggedBatch(null);
    },
    [canSchedule],
  );

  const handleOverlayCellClick = useCallback(
    (resourceId: string, date: string) => {
      if (!movingBatch) return;

      const dateChanged = movingBatch.planDate !== date;
      const resourceChanged = movingBatch.planResourceId !== resourceId;

      if (!dateChanged && !resourceChanged) {
        setMovingBatch(null);
        return;
      }

      // Validate scheduling rules BEFORE showing the reason modal — rules must
      // block the move regardless of whether a reason is required.
      if (resourceChanged) {
        const newResource = resources.find((r) => r.id === resourceId);
        if (newResource) {
          const cellBatches = (batchesByResource.get(resourceId) ?? []).filter(
            (b) => b.planDate === date && b.id !== movingBatch.id,
          );
          const evalResult = evaluateDropTarget({
            batch: movingBatch,
            targetResource: newResource,
            targetDate: date,
            existingBatches: cellBatches,
            rules: enabledRules,
            colourGroups,
            colourTransitions,
            substitutionRules,
          });
          if (!evalResult.valid) {
            toast.error(`Move blocked: ${evalResult.warnings.join("; ")}`);
            setMovingBatch(null);
            return;
          }
        }
      }

      // Require a reason if: Production role (all moves), or date changed and
      // the move is within the current week / crosses a week boundary (fringe days)
      const needsComment = dateChanged
        ? isMoveCommentRequired(movingBatch.planDate!, date)
        : requiresReasonForAllMoves;

      if (needsComment) {
        setMoveModal({
          batch: movingBatch,
          targetResourceId: resourceId,
          targetDate: date,
        });
        setMovingBatch(null);
        return;
      }

      // No comment needed — execute directly
      executeBatchMove(movingBatch, resourceId, date);
      setMovingBatch(null);
    },
    [movingBatch, executeBatchMove, requiresReasonForAllMoves, isMoveCommentRequired, resources, batchesByResource, enabledRules, colourGroups, colourTransitions, substitutionRules],
  );

  const handleOverlayCancel = useCallback(() => {
    setMovingBatch(null);
  }, []);

  // Reschedule: triggered by Reschedule button on WOM/WOP batch cards
  const handleRescheduleStart = useCallback(
    (batch: Batch) => {
      if (!canSchedule) return;
      setReschedulingBatch(batch);
      // Cancel any active overlay or drag
      setMovingBatch(null);
      setDraggedBatch(null);
    },
    [canSchedule],
  );

  const colCount = dates.length;

  if (isLoading) {
    return (
      <div className="space-y-3 rounded-lg border p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as ResourceTab)}
        >
          <TabsList>
            <TabsTrigger value="mixers">
              Mixers &amp; Pots ({resources.filter((r) => r.resourceType === "mixer" || r.resourceType === "pot").length})
            </TabsTrigger>
            <TabsTrigger value="dispersers">
              Dispersers ({resources.filter((r) => r.resourceType === "disperser").length})
            </TabsTrigger>
            <TabsTrigger value="all">
              All ({resources.length})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          {/* Move mode indicator */}
          {movingBatch && (
            <div className="flex items-center gap-2 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
              <span>Moving {movingBatch.sapOrder}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-4 w-4"
                onClick={() => setMovingBatch(null)}
                aria-label="Cancel move"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search batches\u2026"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56 pl-9"
            />
            {search && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2"
                onClick={() => setSearch("")}
                aria-label="Clear search"
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
          {search && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {searchMatchCount} match{searchMatchCount !== 1 ? "es" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Capacity overview — collapsible */}
      <div className="rounded-lg border bg-card">
        <button
          onClick={() => setShowCapacity((v) => !v)}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/40 transition-colors"
        >
          <BarChart2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Capacity overview</span>
          <ChevronDown
            className={cn(
              "ml-auto h-4 w-4 text-muted-foreground transition-transform",
              showCapacity && "rotate-180",
            )}
          />
        </button>
        {showCapacity && (
          <div className="border-t p-4">
            <CapacityOverviewWall
              batches={batches}
              resources={resources}
              dates={dates}
              bookendDates={bookendDates}
              kind={tab === "mixers" ? "mixer" : tab === "dispersers" ? "disp" : "all"}
            />
          </div>
        )}
      </div>

      {/* Timeline grid */}
      <div className="rounded-lg border bg-card" ref={timelineRef}>
        <div
          className="grid min-w-[800px]"
          style={{
            gridTemplateColumns: `180px repeat(${colCount}, minmax(120px, 1fr))`,
          }}
        >
          {/* Header: empty corner + date headers (sticky) */}
          <div className="sticky top-0 left-0 z-40 border-b border-r bg-muted px-3 py-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase">
              Resource
            </span>
          </div>
          {dates.map((dateStr) => {
            const date = new Date(dateStr + "T12:00:00");
            const today = isToday(date);
            const weekend = isWeekend(date);
            const isBookend = !coreDateSet.has(dateStr);
            const isDayBlocked = dayBlockedSet.has(dateStr);
            const dayBlockReason = dayBlockedMap.get(dateStr) ?? null;
            const { total, completed } = completionByDate.get(dateStr) ?? { total: 0, completed: 0 };
            const pct = total > 0 ? (completed / total) * 100 : 0;
            return (
              <div
                key={dateStr}
                className={cn(
                  "sticky top-0 z-30 border-b border-r px-2 py-2 text-center bg-card",
                  today && "bg-primary/5 ring-1 ring-inset ring-primary/15",
                  weekend && "bg-muted",
                  isBookend && "bg-muted/60 opacity-70",
                  isDayBlocked && "bg-muted/80 text-muted-foreground",
                )}
              >
                <div className={cn("text-xs font-semibold", isBookend && "text-muted-foreground")}>
                  {format(date, "EEE")}
                  {isBookend && (
                    <span className="ml-1 text-[9px] font-normal text-muted-foreground/70">
                      {dateStr < (coreDates[0] ?? dateStr) ? "(prev)" : "(next)"}
                    </span>
                  )}
                </div>
                <div
                  className={cn(
                    "text-sm tabular-nums",
                    today && "font-semibold text-foreground",
                    isBookend && "text-muted-foreground",
                  )}
                >
                  {format(date, "d MMM")}
                </div>
                {isDayBlocked && (
                  <div className="mt-0.5 text-[9px] font-semibold uppercase text-destructive">
                    {dayBlockReason || "Blocked"}
                  </div>
                )}
                {total > 0 && !isDayBlocked && (
                  <div className="mt-1.5 space-y-0.5">
                    <div className="h-1 w-full rounded-full bg-muted-foreground/20 overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-300",
                          pct === 100
                            ? "bg-emerald-500"
                            : pct > 0
                              ? "bg-amber-400"
                              : "bg-muted-foreground/30",
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[9px] tabular-nums text-muted-foreground">
                      {completed}/{total}
                    </span>
                  </div>
                )}
              </div>
            );
          })}

          {/* Placement overlay (shown when a batch is being moved via Move button) */}
          {movingBatch && (
            <PlacementOverlay
              movingBatch={movingBatch}
              resources={allVisibleResources}
              dates={dates}
              batches={batches}
              blocks={blocks}
              colourGroups={colourGroups}
              colourTransitions={colourTransitions}
              substitutionRules={substitutionRules}
              scheduleRules={scheduleRules}
              onCellClick={handleOverlayCellClick}
              onCancel={handleOverlayCancel}
            />
          )}

          {/* Resource lanes and pot groups interleaved by sort_order (hidden when overlay is active) */}
          {!movingBatch && sortedLanes.map((lane) =>
            lane.type === "mixer" ? (
              <ResourceLane
                key={lane.resource.id}
                resource={lane.resource}
                dates={dates}
                batches={batchesByResource.get(lane.resource.id) ?? []}
                blocks={blocks}
                dayBlockedMap={dayBlockedMap}
                bookendDates={bookendDates}
                highlightedBatchIds={
                  search ? highlightedBatchIds : undefined
                }
                spotlightBatchId={spotlightBatchId}
                spotlightTargetResourceId={spotlightTargetResourceId}
                movementDirections={movementDirections}
                draggedBatchId={draggedBatch?.id ?? null}
                dropTargets={dropTargets}
                canDrag={canSchedule}
                canSchedule={canSchedule}
                coverageLevels={coverageLevels}
                lidFlags={lidFlags}
                alertBatchIds={alertBatchIds}
                onBatchClick={onBatchClick}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDrop={handleDrop}
                onMoveStart={handleMoveStart}
                onReschedule={handleRescheduleStart}
              />
            ) : (
              <GroupedPotLane
                key={lane.group.name}
                groupName={lane.group.name}
                resources={lane.group.resources}
                dates={dates}
                batches={batchesByPotGroup.get(lane.group.name) ?? []}
                dayBlockedMap={dayBlockedMap}
                bookendDates={bookendDates}
                highlightedBatchIds={
                  search ? highlightedBatchIds : undefined
                }
                draggedBatchId={draggedBatch?.id ?? null}
                dropTargets={dropTargets}
                canDrag={canSchedule}
                canSchedule={canSchedule}
                coverageLevels={coverageLevels}
                lidFlags={lidFlags}
                alertBatchIds={alertBatchIds}
                onBatchClick={onBatchClick}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDrop={handleDrop}
                onMoveStart={handleMoveStart}
                onReschedule={handleRescheduleStart}
              />
            ),
          )}

          {/* Empty state */}
          {filteredResources.length === 0 && potGroups.length === 0 && (
            <div
              className="col-span-full flex items-center justify-center py-12 text-muted-foreground"
            >
              No {tab === "all" ? "resources" : tab} configured for this site.
            </div>
          )}
        </div>
      </div>

      {/* Move reason modal */}
      {moveModal && (
        <MoveReasonModal
          open={!!moveModal}
          onOpenChange={(open) => {
            if (!open) setMoveModal(null);
          }}
          sapOrder={moveModal.batch.sapOrder}
          oldDate={moveModal.batch.planDate ?? ""}
          newDate={moveModal.targetDate}
          oldResource={
            resources.find((r) => r.id === moveModal.batch.planResourceId)
              ?.displayName ??
            resources.find((r) => r.id === moveModal.batch.planResourceId)
              ?.resourceCode ??
            "Unassigned"
          }
          newResource={
            resources.find((r) => r.id === moveModal.targetResourceId)
              ?.displayName ??
            resources.find((r) => r.id === moveModal.targetResourceId)
              ?.resourceCode ??
            ""
          }
          onConfirm={handleMoveConfirm}
        />
      )}

      {/* Reschedule dialog for WOM/WOP batches */}
      {reschedulingBatch && (
        <RescheduleDialog
          open={!!reschedulingBatch}
          onOpenChange={(open) => {
            if (!open) setReschedulingBatch(null);
          }}
          batch={reschedulingBatch}
          resources={resources}
          batches={batches}
          blocks={blocks}
          colourGroups={colourGroups}
          colourTransitions={colourTransitions}
          substitutionRules={substitutionRules}
          scheduleRules={scheduleRules}
        />
      )}
    </div>
  );
}
