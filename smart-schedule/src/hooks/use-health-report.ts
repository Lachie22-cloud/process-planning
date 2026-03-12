import { useMemo } from "react";
import { useBatches } from "./use-batches";
import { useResources } from "./use-resources";
import { useResourceBlocks } from "./use-resource-blocks";
import { useColourGroups, useColourTransitions } from "./use-colour-groups";
import { useSubstitutionRules, useScheduleRules } from "./use-rules";
import { createHealthScorer } from "@/lib/utils/health-scoring";
import { createScorer } from "@/lib/utils/placement-scoring";
import type { HealthReport, HealthScoringContext, ScoringBatch, ScoringResource, ScoringResourceBlock, ScoringSubstitutionRule } from "@/types/scoring";
import type { Batch } from "@/types/batch";
import type { Resource } from "@/types/resource";
import type { ResourceBlock } from "@/types/site";
import type { SubstitutionRule } from "@/types/rule";

/* ------------------------------------------------------------------ */
/*  Mappers: domain types → scoring types                              */
/* ------------------------------------------------------------------ */

function toBatchScoring(b: Batch): ScoringBatch {
  return {
    id: b.id,
    batchVolume: b.batchVolume,
    sapColorGroup: b.sapColorGroup,
    chemicalBase: null,
    status: b.status,
    rmAvailable: b.rmAvailable,
    packagingAvailable: b.packagingAvailable,
    rmAvailableDate: null,
    packagingAvailableDate: null,
    planResourceId: b.planResourceId,
    planDate: b.planDate,
    bulkCode: b.bulkCode,
  };
}

function toResourceScoring(r: Resource): ScoringResource {
  return {
    id: r.id,
    minCapacity: r.minCapacity ?? null,
    maxCapacity: r.maxCapacity ?? null,
    maxBatchesPerDay: r.maxBatchesPerDay ?? 4,
    chemicalBase: r.chemicalBase ?? null,
    trunkLine: r.trunkLine ?? null,
    groupName: r.groupName ?? null,
    active: r.active,
  };
}

function toBlockScoring(b: ResourceBlock): ScoringResourceBlock {
  return {
    resourceId: b.resourceId,
    startDate: b.startDate,
    endDate: b.endDate,
  };
}

function toSubstitutionScoring(r: SubstitutionRule): ScoringSubstitutionRule {
  return {
    sourceResourceId: r.sourceResourceId,
    targetResourceId: r.targetResourceId,
    conditions: r.conditions,
    enabled: r.enabled,
  };
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

interface UseHealthReportOptions {
  weekStart?: string;
  weekEnding?: string;
}

interface UseHealthReportResult {
  report: HealthReport | null;
  isLoading: boolean;
  isError: boolean;
}

export function useHealthReport(options: UseHealthReportOptions = {}): UseHealthReportResult {
  const { data: batches = [], isLoading: batchesLoading, isError: batchesError } = useBatches(options);
  const { data: resources = [], isLoading: resourcesLoading, isError: resourcesError } = useResources();
  const { data: blocks = [], isLoading: blocksLoading, isError: blocksError } = useResourceBlocks(options);
  const { data: colourGroups = [], isLoading: cgLoading, isError: cgError } = useColourGroups();
  const { data: transitions = [], isLoading: ctLoading, isError: ctError } = useColourTransitions();
  const { data: subRules = [], isLoading: srLoading, isError: srError } = useSubstitutionRules();
  const { data: scheduleRules = [], isLoading: rulesLoading, isError: rulesError } = useScheduleRules();

  const isLoading = batchesLoading || resourcesLoading || blocksLoading || cgLoading || ctLoading || srLoading || rulesLoading;
  const isError = batchesError || resourcesError || blocksError || cgError || ctError || srError || rulesError;

  const report = useMemo<HealthReport | null>(() => {
    if (isLoading) return null;

    const placementScorer = createScorer(scheduleRules);
    const healthScorer = createHealthScorer(placementScorer);

    const scoringBatches = batches.map(toBatchScoring);
    const scoringResources = resources.map(toResourceScoring);
    const scoringBlocks = blocks.map(toBlockScoring);
    const scoringSubRules = subRules.map(toSubstitutionScoring);

    const trunkLines: Record<string, string | null> = {};
    for (const r of scoringResources) {
      trunkLines[r.id] = r.trunkLine;
    }

    const ctx: HealthScoringContext = {
      batches: scoringBatches,
      resources: scoringResources,
      resourceBlocks: scoringBlocks,
      colourTransitions: transitions.map((t) => ({
        fromGroupId: t.fromGroupId,
        toGroupId: t.toGroupId,
        allowed: t.allowed,
        requiresWashout: t.requiresWashout,
        washoutMinutes: t.washoutMinutes ?? 0,
      })),
      colourGroups: colourGroups.map((g) => ({
        id: g.id,
        code: g.code,
        name: g.name,
        sortOrder: g.sortOrder,
      })),
      substitutionRules: scoringSubRules,
      resourceTrunkLines: trunkLines,
    };

    return healthScorer.evaluate(ctx);
  }, [isLoading, batches, resources, blocks, colourGroups, transitions, subRules, scheduleRules]);

  return { report, isLoading, isError };
}
