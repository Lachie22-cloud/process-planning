import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/ui/cn";
import {
  AlertTriangle,
  Package,
  Calendar,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Info,
} from "lucide-react";
import { format, addDays } from "date-fns";
import { toast } from "sonner";
import { PlacementScorer, extractWeights } from "@/lib/utils/placement-scoring";
import { useUpdateBatch, useAddAuditEntry } from "@/hooks/use-batch-mutations";
import { useRecordMovement } from "@/hooks/use-schedule-movements";
import { useCurrentSite } from "@/hooks/use-current-site";
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
import type { SubstitutionRule, ScheduleRule } from "@/types/rule";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toScoringBatch(batch: Batch): ScoringBatch {
  return {
    id: batch.id,
    batchVolume: batch.batchVolume,
    sapColorGroup: batch.sapColorGroup,
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

function formatDateLabel(dateStr: string): string {
  try {
    return format(new Date(dateStr + "T12:00:00"), "EEE d MMM yyyy");
  } catch {
    return dateStr;
  }
}

function formatShortDate(dateStr: string): string {
  try {
    return format(new Date(dateStr + "T12:00:00"), "EEE d MMM");
  } catch {
    return dateStr;
  }
}

/** Determine the earliest date this batch can be scheduled based on PO/availability dates */
function getEarliestAvailableDate(batch: Batch): string | null {
  const candidates: string[] = [];

  // PO date is the expected delivery date for materials
  if (batch.poDate) {
    candidates.push(batch.poDate);
  }

  // If we don't have any date clue, return null
  if (candidates.length === 0) return null;

  // Return the latest of the candidates (materials must all be available)
  return candidates.sort().pop() ?? null;
}

/** Get the score colour class for visual feedback */
function getScoreBgClass(score: number, feasible: boolean): string {
  if (!feasible) return "bg-gray-100 dark:bg-gray-800";
  if (score >= 70) return "bg-emerald-50 dark:bg-emerald-950/30";
  if (score >= 40) return "bg-yellow-50 dark:bg-yellow-950/30";
  if (score >= 15) return "bg-orange-50 dark:bg-orange-950/30";
  return "bg-red-50 dark:bg-red-950/30";
}

function getScoreTextClass(score: number, feasible: boolean): string {
  if (!feasible) return "text-gray-500";
  if (score >= 70) return "text-emerald-700 dark:text-emerald-300";
  if (score >= 40) return "text-yellow-700 dark:text-yellow-300";
  if (score >= 15) return "text-orange-700 dark:text-orange-300";
  return "text-red-700 dark:text-red-300";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RankedOption {
  resourceId: string;
  resourceName: string;
  date: string;
  score: PlacementScore;
}

interface RescheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batch: Batch;
  resources: Resource[];
  batches: Batch[];
  blocks: ResourceBlock[];
  colourGroups: ColourGroup[];
  colourTransitions: ColourTransition[];
  substitutionRules: SubstitutionRule[];
  scheduleRules: ScheduleRule[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RescheduleDialog({
  open,
  onOpenChange,
  batch,
  resources,
  batches,
  blocks,
  colourGroups,
  colourTransitions,
  substitutionRules,
  scheduleRules,
}: RescheduleDialogProps) {
  const [selectedOption, setSelectedOption] = useState<RankedOption | null>(null);
  const updateBatch = useUpdateBatch();
  const addAudit = useAddAuditEntry();
  const recordMovement = useRecordMovement();
  const { user } = useCurrentSite();

  const isExecuting = updateBatch.isPending;

  // Determine material issues
  const isWom = !batch.rmAvailable;
  const isWop = !batch.packagingAvailable;

  // Determine the earliest date after which materials are expected
  const earliestDate = getEarliestAvailableDate(batch);

  // Build scorer
  const scorer = useMemo(
    () => new PlacementScorer(extractWeights(scheduleRules)),
    [scheduleRules],
  );

  const scoringBatch = useMemo(() => toScoringBatch(batch), [batch]);

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

  const activeResourceCount = useMemo(
    () => resources.filter((r) => r.active).length,
    [resources],
  );

  // Group batches by resource+date
  const batchesByCell = useMemo(() => {
    const map = new Map<string, ScoringBatch[]>();
    for (const b of batches) {
      if (b.planResourceId && b.planDate && b.id !== batch.id) {
        const key = `${b.planResourceId}:${b.planDate}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(toScoringBatch(b));
      }
    }
    return map;
  }, [batches, batch.id]);

  const batchesByDate = useMemo(() => {
    const map = new Map<string, ScoringBatch[]>();
    for (const b of batches) {
      if (b.planDate && b.id !== batch.id) {
        if (!map.has(b.planDate)) map.set(b.planDate, []);
        map.get(b.planDate)!.push(toScoringBatch(b));
      }
    }
    return map;
  }, [batches, batch.id]);

  // Generate candidate dates: start from the day AFTER expected delivery (or tomorrow
  // if delivery date is unknown), then scan 14 days forward.
  const candidateDates = useMemo(() => {
    const startDate = earliestDate
      ? addDays(new Date(earliestDate + "T12:00:00"), 1)
      : addDays(new Date(), 1);

    const dates: string[] = [];
    for (let i = 0; i < 14; i++) {
      dates.push(format(addDays(startDate, i), "yyyy-MM-dd"));
    }
    return dates;
  }, [earliestDate]);

  // Score all resource×date combinations and rank them
  const rankedOptions = useMemo(() => {
    if (!open) return [];

    const options: RankedOption[] = [];
    const activeResources = resources.filter((r) => r.active);

    for (const resource of activeResources) {
      const scoringResource = toScoringResource(resource);
      for (const date of candidateDates) {
        const key = `${resource.id}:${date}`;
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

        const score = scorer.score(scoringBatch, scoringResource, date, ctx);

        options.push({
          resourceId: resource.id,
          resourceName:
            resource.displayName ?? resource.resourceCode,
          date,
          score,
        });
      }
    }

    // Sort: feasible first, then by score descending
    options.sort((a, b) => {
      if (a.score.feasible !== b.score.feasible) {
        return a.score.feasible ? -1 : 1;
      }
      return b.score.score - a.score.score;
    });

    // Return top 20 feasible + top 5 infeasible for reference
    const feasible = options.filter((o) => o.score.feasible).slice(0, 20);
    const infeasible = options.filter((o) => !o.score.feasible).slice(0, 5);
    return [...feasible, ...infeasible];
  }, [
    open,
    resources,
    candidateDates,
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

  const handleReschedule = () => {
    if (!selectedOption || !selectedOption.score.feasible) return;

    const oldResource = resources.find((r) => r.id === batch.planResourceId);
    const newResource = resources.find((r) => r.id === selectedOption.resourceId);

    updateBatch.mutate(
      {
        batchId: batch.id,
        updates: {
          planResourceId: selectedOption.resourceId,
          planDate: selectedOption.date,
        },
      },
      {
        onSuccess: () => {
          const dateChanged = batch.planDate !== selectedOption.date;
          const direction: "pulled" | "pushed" | "moved" = dateChanged
            ? selectedOption.date < (batch.planDate ?? "")
              ? "pulled"
              : "pushed"
            : "moved";

          const reason = `Rescheduled due to ${[isWom && "WOM", isWop && "WOP"].filter(Boolean).join("/")} – moved to after ${earliestDate ? formatDateLabel(earliestDate) : "expected delivery"} (score: ${Math.round(selectedOption.score.score)})`;

          addAudit.mutate({
            batchId: batch.id,
            action: "batch_reschedule",
            details: {
              from_date: batch.planDate,
              to_date: selectedOption.date,
              from_resource: oldResource?.resourceCode ?? batch.planResourceId,
              to_resource: newResource?.resourceCode ?? selectedOption.resourceId,
              direction,
              reason,
              placement_score: Math.round(selectedOption.score.score),
              trigger: [isWom && "wom", isWop && "wop"].filter(Boolean),
              moved_by: user?.email ?? user?.id ?? "unknown",
            },
          });

          recordMovement.mutate({
            batchId: batch.id,
            fromResourceId: batch.planResourceId,
            toResourceId: selectedOption.resourceId,
            fromDate: batch.planDate,
            toDate: selectedOption.date,
            direction,
            reason,
          });

          toast.success(
            `Rescheduled ${batch.sapOrder} to ${newResource?.displayName ?? newResource?.resourceCode ?? "resource"} on ${formatShortDate(selectedOption.date)}`,
          );
          onOpenChange(false);
          setSelectedOption(null);
        },
        onError: (err) => {
          toast.error(
            err instanceof Error ? err.message : "Failed to reschedule batch",
          );
        },
      },
    );
  };

  const feasibleCount = rankedOptions.filter((o) => o.score.feasible).length;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setSelectedOption(null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Reschedule {batch.sapOrder}</DialogTitle>
          <DialogDescription>
            Find the best placement after materials become available.
          </DialogDescription>
        </DialogHeader>

        {/* Batch info summary */}
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {isWom && (
              <Badge
                variant="outline"
                className="border-orange-300 bg-orange-50 text-orange-700"
              >
                <AlertTriangle className="mr-1 h-3 w-3" />
                Waiting on Materials
              </Badge>
            )}
            {isWop && (
              <Badge
                variant="outline"
                className="border-amber-300 bg-amber-50 text-amber-700"
              >
                <Package className="mr-1 h-3 w-3" />
                Waiting on Packaging
              </Badge>
            )}
          </div>

          <div className="rounded-md bg-muted p-3 text-sm space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Current:</span>
              <span className="font-medium">
                {resources.find((r) => r.id === batch.planResourceId)?.displayName ??
                  resources.find((r) => r.id === batch.planResourceId)?.resourceCode ??
                  "Unassigned"}
              </span>
              <span className="text-muted-foreground">on</span>
              <span className="font-medium">
                {batch.planDate ? formatShortDate(batch.planDate) : "No date"}
              </span>
            </div>
            {batch.poDate && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-3 w-3" />
                <span>PO delivery: {formatDateLabel(batch.poDate)}</span>
              </div>
            )}
            {earliestDate && (
              <div className="flex items-center gap-2 text-xs">
                <Info className="h-3 w-3 text-blue-500" />
                <span>
                  Scoring dates from day after delivery:{" "}
                  <span className="font-medium">{formatDateLabel(earliestDate)}</span>{" "}
                  + 1 (14 day window)
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Ranked options list */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">
              Best Placements
            </h4>
            <span className="text-xs text-muted-foreground">
              {feasibleCount} option{feasibleCount !== 1 ? "s" : ""} found
            </span>
          </div>

          <ScrollArea className="h-[300px] rounded-md border">
            <div className="space-y-1 p-2">
              {rankedOptions.length === 0 && (
                <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                  No placement options found in the date range.
                </div>
              )}
              {rankedOptions.map((option) => {
                const isSelected =
                  selectedOption?.resourceId === option.resourceId &&
                  selectedOption?.date === option.date;
                const isCurrent =
                  option.resourceId === batch.planResourceId &&
                  option.date === batch.planDate;

                return (
                  <button
                    key={`${option.resourceId}:${option.date}`}
                    type="button"
                    disabled={!option.score.feasible || isCurrent}
                    className={cn(
                      "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      option.score.feasible
                        ? "hover:ring-2 hover:ring-primary/50 cursor-pointer"
                        : "opacity-50 cursor-not-allowed",
                      isSelected && "ring-2 ring-primary border-primary",
                      !isSelected && getScoreBgClass(option.score.score, option.score.feasible),
                    )}
                    onClick={() => {
                      if (option.score.feasible && !isCurrent) {
                        setSelectedOption(option);
                      }
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        {/* Score badge */}
                        <span
                          className={cn(
                            "inline-flex items-center justify-center rounded-md px-2 py-0.5 font-mono text-xs font-bold tabular-nums min-w-[40px]",
                            getScoreTextClass(option.score.score, option.score.feasible),
                            getScoreBgClass(option.score.score, option.score.feasible),
                          )}
                        >
                          {option.score.feasible
                            ? Math.round(option.score.score)
                            : "N/A"}
                        </span>

                        {/* Resource name */}
                        <span className="font-medium truncate">
                          {option.resourceName}
                        </span>

                        <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />

                        {/* Date */}
                        <span className="text-muted-foreground whitespace-nowrap">
                          {formatShortDate(option.date)}
                        </span>

                        {isCurrent && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0">
                            Current
                          </Badge>
                        )}
                      </div>

                      {/* Factor breakdown tooltip */}
                      {option.score.feasible && option.score.factors.length > 0 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground hover:text-foreground" />
                          </TooltipTrigger>
                          <TooltipContent
                            side="left"
                            className="max-w-xs"
                          >
                            <div className="space-y-1 text-xs">
                              {option.score.factors.map((f) => (
                                <div
                                  key={f.factor}
                                  className="flex items-center justify-between gap-3"
                                >
                                  <span className="text-muted-foreground capitalize">
                                    {f.factor.replace(/_/g, " ")}
                                  </span>
                                  <span
                                    className={cn(
                                      "font-mono tabular-nums",
                                      f.weighted > 0
                                        ? "text-emerald-600"
                                        : f.weighted < 0
                                          ? "text-red-500"
                                          : "text-muted-foreground",
                                    )}
                                  >
                                    {f.weighted > 0 ? "+" : ""}
                                    {f.weighted.toFixed(1)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      )}

                      {/* Violations for infeasible */}
                      {!option.score.feasible && (
                        <span className="text-[10px] text-red-500 shrink-0">
                          {option.score.violations.join(", ")}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleReschedule}
            disabled={!selectedOption || isExecuting}
          >
            {isExecuting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Rescheduling...
              </>
            ) : selectedOption ? (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Reschedule to {formatShortDate(selectedOption.date)}
              </>
            ) : (
              "Select a placement"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
