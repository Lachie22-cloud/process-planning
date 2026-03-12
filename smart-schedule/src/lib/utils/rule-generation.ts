import type { Resource } from "@/types/resource";
import type { SubstitutionConditions, SubstitutionRule } from "@/types/rule";
import type { SubstitutionGenerationConfig } from "@/lib/validators/substitution-generation-settings";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CandidateRule {
  sourceResourceId: string;
  targetResourceId: string;
  conditions: SubstitutionConditions | null;
  enabled: boolean;
  /** Why this candidate was flagged, if at all */
  duplicateStatus: "new" | "skipped" | "upsert" | "created_disabled";
}

export interface GenerationResult {
  candidates: CandidateRule[];
  /** Rules that matched an existing rule and were skipped */
  skippedCount: number;
  /** Total pairs evaluated before duplicate filtering */
  totalPairsEvaluated: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the grouping key(s) for a resource based on config */
function getGroupKey(
  resource: Resource,
  groupByKey: "group" | "trunk_line" | "both",
): string | null {
  switch (groupByKey) {
    case "group":
      return resource.groupName;
    case "trunk_line":
      return resource.trunkLine;
    case "both":
      if (resource.groupName == null && resource.trunkLine == null) return null;
      return `${resource.groupName ?? ""}|${resource.trunkLine ?? ""}`;
  }
}

/** Check whether two resources share the same chemical base */
function sameChemicalBase(a: Resource, b: Resource): boolean {
  if (a.chemicalBase == null || b.chemicalBase == null) return false;
  return a.chemicalBase === b.chemicalBase;
}

/** Determine the capacity relationship between source and target */
function capacityRelationship(
  source: Resource,
  target: Resource,
): "large_to_small" | "small_to_large" | "same" {
  const srcCap = source.maxCapacity ?? 0;
  const tgtCap = target.maxCapacity ?? 0;
  if (srcCap > tgtCap) return "large_to_small";
  if (srcCap < tgtCap) return "small_to_large";
  return "same";
}

/** Build conditions for a pair based on the config */
function buildConditions(
  source: Resource,
  target: Resource,
  config: SubstitutionGenerationConfig,
): SubstitutionConditions | null {
  const relationship = capacityRelationship(source, target);
  const strategy = config.capacityStrategy;

  // Determine which template to use
  let template: "maxVolume" | "minVolume" | "both" | null;
  switch (relationship) {
    case "large_to_small":
      template = strategy.largeToSmallTemplate;
      break;
    case "small_to_large":
      template = strategy.smallToLargeTemplate;
      break;
    case "same":
      template = strategy.sameCapacityTemplate;
      break;
  }

  // If applyBothMinMax is on, override to "both"
  if (template != null && strategy.applyBothMinMax) {
    template = "both";
  }

  if (template == null) return null;

  const conditions: SubstitutionConditions = {};

  // Apply capacity-based conditions from the TARGET resource
  const useMax =
    template === "maxVolume" || template === "both";
  const useMin =
    template === "minVolume" || template === "both";

  if (useMax && config.conditionTemplates.maxVolume && target.maxCapacity != null) {
    conditions.maxVolume = target.maxCapacity;
  }
  if (useMin && config.conditionTemplates.minVolume && target.minCapacity != null) {
    conditions.minVolume = target.minCapacity;
  }

  // Return null if no conditions were actually set
  if (Object.keys(conditions).length === 0) return null;

  return conditions;
}

/** Unique key for a source→target pair */
function pairKey(sourceId: string, targetId: string): string {
  return `${sourceId}→${targetId}`;
}

// ---------------------------------------------------------------------------
// Eligibility filtering
// ---------------------------------------------------------------------------

function filterEligibleResources(
  resources: Resource[],
  config: SubstitutionGenerationConfig,
): Resource[] {
  return resources.filter((r) => {
    // Active check
    if (!config.resourceEligibility.includeInactive && !r.active) return false;

    // Missing fields check
    if (config.resourceEligibility.excludeMissingFields) {
      const key = getGroupKey(r, config.resourceEligibility.groupByKey);
      if (key == null) return false;
    }

    return true;
  });
}

// ---------------------------------------------------------------------------
// Pair generation
// ---------------------------------------------------------------------------

function shouldPair(
  a: Resource,
  b: Resource,
  config: SubstitutionGenerationConfig,
): boolean {
  const groupByKey = config.resourceEligibility.groupByKey;
  const aGroup = getGroupKey(a, groupByKey);
  const bGroup = getGroupKey(b, groupByKey);
  const isSameGroup = aGroup != null && bGroup != null && aGroup === bGroup;

  // Chemical base filtering
  if (!config.scope.crossChemicalBase && !sameChemicalBase(a, b)) {
    return false;
  }

  if (isSameGroup) {
    return config.scope.sameGroup;
  }

  // Cross-group check
  if (!config.scope.crossGroup) return false;

  // Trunk-line filtering (only relevant for cross-group pairs)
  if (!config.scope.crossTrunkLine) {
    // If they have different trunk lines, block the pair
    const sameTrunk =
      a.trunkLine != null && b.trunkLine != null && a.trunkLine === b.trunkLine;
    if (!sameTrunk) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Main generation function
// ---------------------------------------------------------------------------

/**
 * Pure function that generates candidate substitution rules from resources and config.
 *
 * Does NOT perform any I/O — the caller is responsible for persisting results.
 */
export function generateSubstitutionRules(
  resources: Resource[],
  config: SubstitutionGenerationConfig,
  existingRules: SubstitutionRule[],
): GenerationResult {
  // 1. Filter to eligible resources
  const eligible = filterEligibleResources(resources, config);

  // 2. Build lookup of existing rules for duplicate detection
  const existingPairs = new Map<string, SubstitutionRule>();
  for (const rule of existingRules) {
    if (rule.sourceResourceId && rule.targetResourceId) {
      existingPairs.set(
        pairKey(rule.sourceResourceId, rule.targetResourceId),
        rule,
      );
    }
  }

  // 3. Generate all valid pairs and build candidates
  const candidates: CandidateRule[] = [];
  let skippedCount = 0;
  let totalPairsEvaluated = 0;

  for (let i = 0; i < eligible.length; i++) {
    for (let j = 0; j < eligible.length; j++) {
      if (i === j) continue;

      const source = eligible[i]!;
      const target = eligible[j]!;

      if (!shouldPair(source, target, config)) continue;

      totalPairsEvaluated++;

      const conditions = buildConditions(source, target, config);

      // Check for duplicates
      const key = pairKey(source.id, target.id);
      const existing = existingPairs.get(key);

      if (existing) {
        // Check if disabled rules count as duplicates
        if (!existing.enabled && !config.safety.disabledCountAsDuplicates) {
          // Disabled rule doesn't count — treat as new
        } else {
          // It's a duplicate — apply policy
          switch (config.safety.duplicatePolicy) {
            case "skip":
              skippedCount++;
              candidates.push({
                sourceResourceId: source.id,
                targetResourceId: target.id,
                conditions,
                enabled: true,
                duplicateStatus: "skipped",
              });
              continue;
            case "upsert":
              candidates.push({
                sourceResourceId: source.id,
                targetResourceId: target.id,
                conditions,
                enabled: true,
                duplicateStatus: "upsert",
              });
              continue;
            case "create_disabled":
              candidates.push({
                sourceResourceId: source.id,
                targetResourceId: target.id,
                conditions,
                enabled: false,
                duplicateStatus: "created_disabled",
              });
              continue;
          }
        }
      }

      candidates.push({
        sourceResourceId: source.id,
        targetResourceId: target.id,
        conditions,
        enabled: true,
        duplicateStatus: "new",
      });
    }
  }

  return { candidates, skippedCount, totalPairsEvaluated };
}
