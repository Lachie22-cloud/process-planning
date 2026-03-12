import { useMemo, useEffect, useCallback } from "react";
import { cn } from "@/lib/ui/cn";
import { ScoreTooltip } from "./score-tooltip";
import { PlacementScorer, extractWeights } from "@/lib/utils/placement-scoring";
import type { Batch } from "@/types/batch";
import type { Resource } from "@/types/resource";
import type { ResourceBlock } from "@/types/site";
import type {
  PlacementScore,
  ScoringBatch,
  ScoringContext,
  ScoringResource,
  ScoringSubstitutionRule,
  ColourGroup as ScoringColourGroup,
  ColourTransition as ScoringColourTransition,
} from "@/types/scoring";
import type { ColourGroup } from "@/hooks/use-colour-groups";
import type { ColourTransition } from "@/hooks/use-colour-groups";
import type { SubstitutionRule } from "@/types/rule";
import type { ScheduleRule } from "@/types/rule";

// ---------------------------------------------------------------------------
// Score → colour mapping
// ---------------------------------------------------------------------------

/**
 * Return a Tailwind background class for the given score.
 * Green (70+) → Yellow (40–69) → Orange (15–39) → Red (1–14) → Grey (0/blocked)
 */
function getScoreColourClass(score: PlacementScore): string {
  if (!score.feasible) {
    return "bg-gray-300/60 dark:bg-gray-700/50";
  }
  if (score.score >= 70) {
    return "bg-emerald-200/70 dark:bg-emerald-800/50";
  }
  if (score.score >= 40) {
    return "bg-yellow-200/70 dark:bg-yellow-700/40";
  }
  if (score.score >= 15) {
    return "bg-orange-200/70 dark:bg-orange-800/40";
  }
  return "bg-red-200/70 dark:bg-red-800/40";
}

// ---------------------------------------------------------------------------
// Batch → ScoringBatch helper
// ---------------------------------------------------------------------------

function toScoringBatch(batch: Batch): ScoringBatch {
  return {
    id: batch.id,
    batchVolume: batch.batchVolume,
    sapColorGroup: batch.sapColorGroup,
    // chemicalBase may not be on the Batch type yet — default to null
    chemicalBase: null,
    status: batch.status,
    rmAvailable: batch.rmAvailable,
    packagingAvailable: batch.packagingAvailable,
    planResourceId: batch.planResourceId,
    planDate: batch.planDate,
    bulkCode: batch.bulkCode,
  };
}

function toScoringResource(resource: Resource): ScoringResource {
  return {
    id: resource.id,
    minCapacity: resource.minCapacity,
    maxCapacity: resource.maxCapacity,
    maxBatchesPerDay: resource.maxBatchesPerDay,
    chemicalBase: resource.chemicalBase,
    trunkLine: resource.trunkLine,
    groupName: resource.groupName,
    active: resource.active,
  };
}

function toScoringColourGroups(groups: ColourGroup[]): ScoringColourGroup[] {
  return groups.map((g) => ({
    id: g.id,
    code: g.code,
    name: g.name,
    sortOrder: g.sortOrder,
  }));
}

function toScoringColourTransitions(
  transitions: ColourTransition[],
): ScoringColourTransition[] {
  return transitions.map((t) => ({
    fromGroupId: t.fromGroupId,
    toGroupId: t.toGroupId,
    allowed: t.allowed,
    requiresWashout: t.requiresWashout,
    washoutMinutes: t.washoutMinutes ?? 0,
  }));
}

function toScoringSubstitutionRules(
  rules: SubstitutionRule[],
): ScoringSubstitutionRule[] {
  return rules.map((r) => ({
    sourceResourceId: r.sourceResourceId,
    targetResourceId: r.targetResourceId,
    conditions: r.conditions,
    enabled: r.enabled,
  }));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CellScore {
  resourceId: string;
  date: string;
  score: PlacementScore;
}

interface PlacementOverlayProps {
  /** The batch being moved */
  movingBatch: Batch;
  /** All visible resources */
  resources: Resource[];
  /** All date columns in the grid */
  dates: string[];
  /** All batches in the current view */
  batches: Batch[];
  /** Resource blocks */
  blocks: ResourceBlock[];
  /** Colour groups for transition scoring */
  colourGroups: ColourGroup[];
  /** Colour transitions for scoring */
  colourTransitions: ColourTransition[];
  /** Substitution rules */
  substitutionRules: SubstitutionRule[];
  /** Schedule rules (for weight extraction) */
  scheduleRules: ScheduleRule[];
  /** Called when user clicks a cell to confirm the move */
  onCellClick: (resourceId: string, date: string, score: PlacementScore) => void;
  /** Called when user cancels the overlay (Escape or click-away) */
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * PlacementOverlay renders a gradient-coloured cell for each resource×date
 * cell in the timeline grid, scored via PlacementScorer. Green = great,
 * red = poor, grey = blocked. Hover shows ScoreTooltip. Click confirms move.
 *
 * Rendered using CSS `display: contents` so it integrates into the parent grid.
 */
export function PlacementOverlay({
  movingBatch,
  resources,
  dates,
  batches,
  blocks,
  colourGroups,
  colourTransitions,
  substitutionRules,
  scheduleRules,
  onCellClick,
  onCancel,
}: PlacementOverlayProps) {
  // Escape key handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCancel();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      // Only cancel if clicking the backdrop itself, not a cell
      if (e.target === e.currentTarget) {
        onCancel();
      }
    },
    [onCancel],
  );

  // Build scorer once
  const scorer = useMemo(
    () => new PlacementScorer(extractWeights(scheduleRules)),
    [scheduleRules],
  );

  // Pre-compute lookup maps
  const scoringBatch = useMemo(
    () => toScoringBatch(movingBatch),
    [movingBatch],
  );

  const scoringColourGroups = useMemo(
    () => toScoringColourGroups(colourGroups),
    [colourGroups],
  );

  const scoringColourTransitions = useMemo(
    () => toScoringColourTransitions(colourTransitions),
    [colourTransitions],
  );

  const scoringSubRules = useMemo(
    () => toScoringSubstitutionRules(substitutionRules),
    [substitutionRules],
  );

  const resourceTrunkLines = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const r of resources) {
      map[r.id] = r.trunkLine;
    }
    return map;
  }, [resources]);

  const resourceBlocks = useMemo(() => {
    return blocks.map((b) => ({
      resourceId: b.resourceId,
      startDate: b.startDate,
      endDate: b.endDate,
    }));
  }, [blocks]);

  // Group batches by resource+date for context building
  const batchesByCell = useMemo(() => {
    const map = new Map<string, ScoringBatch[]>();
    for (const b of batches) {
      if (b.planResourceId && b.planDate && b.id !== movingBatch.id) {
        const key = `${b.planResourceId}:${b.planDate}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(toScoringBatch(b));
      }
    }
    return map;
  }, [batches, movingBatch.id]);

  // All batches by date (for workload balancing)
  const batchesByDate = useMemo(() => {
    const map = new Map<string, ScoringBatch[]>();
    for (const b of batches) {
      if (b.planDate && b.id !== movingBatch.id) {
        if (!map.has(b.planDate)) map.set(b.planDate, []);
        map.get(b.planDate)!.push(toScoringBatch(b));
      }
    }
    return map;
  }, [batches, movingBatch.id]);

  const activeResourceCount = useMemo(
    () => resources.filter((r) => r.active).length,
    [resources],
  );

  // Compute scores for all cells
  const cellScores = useMemo(() => {
    const scores = new Map<string, PlacementScore>();
    for (const resource of resources) {
      const scoringResource = toScoringResource(resource);
      for (const date of dates) {
        const key = `${resource.id}:${date}`;

        // Skip the batch's current cell
        if (
          movingBatch.planResourceId === resource.id &&
          movingBatch.planDate === date
        ) {
          continue;
        }

        const dailyBatches = batchesByCell.get(key) ?? [];
        const allDailyBatches = batchesByDate.get(date) ?? [];

        const ctx: ScoringContext = {
          dailyBatches,
          allDailyBatches,
          resourceBlocks,
          colourTransitions: scoringColourTransitions,
          colourGroups: scoringColourGroups,
          substitutionRules: scoringSubRules,
          activeResourceCount,
          resourceTrunkLines,
        };

        scores.set(key, scorer.score(scoringBatch, scoringResource, date, ctx));
      }
    }
    return scores;
  }, [
    resources,
    dates,
    movingBatch,
    batchesByCell,
    batchesByDate,
    resourceBlocks,
    scoringColourTransitions,
    scoringColourGroups,
    scoringSubRules,
    activeResourceCount,
    resourceTrunkLines,
    scorer,
    scoringBatch,
  ]);

  return (
    <>
      {/* Transparent backdrop for click-away cancel. Positioned fixed behind overlay cells. */}
      <div
        className="fixed inset-0 z-30"
        onClick={handleBackdropClick}
        aria-hidden="true"
      />

      {/* Overlay cells rendered using contents to fit the parent grid */}
      {resources.map((resource) => (
        <div key={`overlay-${resource.id}`} className="contents">
          {/* Empty cell for resource label column */}
          <div className="sticky left-0 z-40" />

          {dates.map((date) => {
            const key = `${resource.id}:${date}`;
            const score = cellScores.get(key);

            // Current cell of the moving batch — show "current" indicator
            if (
              movingBatch.planResourceId === resource.id &&
              movingBatch.planDate === date
            ) {
              return (
                <div
                  key={date}
                  className="relative z-40 flex min-h-[80px] items-center justify-center border-b border-r border-2 border-dashed border-primary/50 bg-primary/10"
                >
                  <span className="text-[10px] font-medium text-primary">
                    Current
                  </span>
                </div>
              );
            }

            if (!score) return <div key={date} className="border-b border-r" />;

            return (
              <ScoreTooltip key={date} score={score}>
                <div
                  className={cn(
                    "relative z-40 flex min-h-[80px] cursor-pointer items-center justify-center border-b border-r transition-all hover:ring-2 hover:ring-primary hover:ring-inset",
                    getScoreColourClass(score),
                    !score.feasible && "cursor-not-allowed opacity-60",
                  )}
                  onClick={() => {
                    if (score.feasible) {
                      onCellClick(resource.id, date, score);
                    }
                  }}
                >
                  <span
                    className={cn(
                      "font-mono text-sm font-bold tabular-nums",
                      !score.feasible
                        ? "text-gray-500 dark:text-gray-400"
                        : score.score >= 70
                          ? "text-emerald-800 dark:text-emerald-200"
                          : score.score >= 40
                            ? "text-yellow-800 dark:text-yellow-200"
                            : score.score >= 15
                              ? "text-orange-800 dark:text-orange-200"
                              : "text-red-800 dark:text-red-200",
                    )}
                  >
                    {score.feasible ? Math.round(score.score) : "—"}
                  </span>
                </div>
              </ScoreTooltip>
            );
          })}
        </div>
      ))}
    </>
  );
}
