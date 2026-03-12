// ---------------------------------------------------------------------------
// PlacementScorer – deterministic placement evaluation engine
// ---------------------------------------------------------------------------
// Pure functions: same input → identical output, no side effects.
// Hard constraints return score 0 with violation codes.
// Soft factors contribute weighted scores when placement is feasible.
// ---------------------------------------------------------------------------

import type {
  ColourGroup,
  HardViolation,
  PlacementScore,
  ScoringBatch,
  ScoringContext,
  ScoringResource,
  ScoringWeights,
  SoftFactorScore,
} from "@/types/scoring";
import { DEFAULT_SCORING_WEIGHTS } from "@/types/scoring";
import type { ScheduleRule } from "@/types/rule";

// ---------------------------------------------------------------------------
// Weight extraction from schedule_rules
// ---------------------------------------------------------------------------

/**
 * Derive scoring weights from the site's enabled schedule_rules.
 * Falls back to DEFAULT_SCORING_WEIGHTS for any value not configured.
 */
export function extractWeights(rules: ScheduleRule[]): ScoringWeights {
  const weights = { ...DEFAULT_SCORING_WEIGHTS };
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const actions = rule.actions as Record<string, unknown> | null;
    if (!actions) continue;

    const conditions = rule.conditions as Record<string, unknown> | null;
    const preference = conditions?.preference as string | undefined;
    const bonus = actions.score_bonus as number | undefined;

    // Preference-based bonuses
    if (preference === "same_trunk_line" && typeof bonus === "number") {
      weights.trunkLineBonus = bonus;
    }
    if (preference === "same_group" && typeof bonus === "number") {
      weights.groupBonus = bonus;
    }

    // Direct weight overrides from actions
    if (typeof actions.colourWashoutPenalty === "number") {
      weights.colourWashoutPenalty = actions.colourWashoutPenalty;
    }
    if (typeof actions.colourCleanBonus === "number") {
      weights.colourCleanBonus = actions.colourCleanBonus;
    }
    if (typeof actions.utilisationWeight === "number") {
      weights.utilisationWeight = actions.utilisationWeight;
    }
    if (typeof actions.workloadWeight === "number") {
      weights.workloadWeight = actions.workloadWeight;
    }
    if (typeof actions.womPenalty === "number") {
      weights.womPenalty = actions.womPenalty;
    }
  }
  return weights;
}

// ---------------------------------------------------------------------------
// PlacementScorer
// ---------------------------------------------------------------------------

export class PlacementScorer {
  readonly defaultWeights: ScoringWeights;

  constructor(defaultWeights: ScoringWeights = DEFAULT_SCORING_WEIGHTS) {
    this.defaultWeights = defaultWeights;
  }

  /**
   * Score placing `batch` on `resource` at `targetDate`.
   * Returns a PlacementScore with score=0 if any hard constraint fails.
   *
   * Effective weights = scorer defaults (from schedule_rules) merged with
   * any per-call overrides in ctx.weights.
   */
  score(
    batch: ScoringBatch,
    resource: ScoringResource,
    targetDate: string,
    ctx: ScoringContext,
  ): PlacementScore {
    // Compute effective weights: scorer defaults + per-call overrides
    const effectiveWeights: ScoringWeights = {
      ...this.defaultWeights,
      ...(ctx.weights ?? {}),
    };

    // Build an internal context that carries the resolved weights
    const resolvedCtx: ScoringContext & { _effectiveWeights: ScoringWeights } = {
      ...ctx,
      _effectiveWeights: effectiveWeights,
    };

    // ---- Hard constraints ------------------------------------------------
    const violations = this.checkHardConstraints(
      batch,
      resource,
      targetDate,
      resolvedCtx,
    );
    if (violations.length > 0) {
      return {
        score: 0,
        feasible: false,
        violations,
        factors: [],
        summary: `Blocked: ${violations.join(", ")}`,
      };
    }

    // ---- Soft factors ----------------------------------------------------
    const factors = this.scoreSoftFactors(
      batch,
      resource,
      targetDate,
      resolvedCtx,
      effectiveWeights,
    );
    const total = factors.reduce((sum, f) => sum + f.weighted, 0);

    return {
      score: Math.max(0, Math.round(total * 100) / 100),
      feasible: true,
      violations: [],
      factors,
      summary: `Score ${Math.round(total)}: ${factors.map((f) => `${f.factor}=${f.weighted}`).join(", ")}`,
    };
  }

  // -----------------------------------------------------------------------
  // Hard constraints
  // -----------------------------------------------------------------------

  private checkHardConstraints(
    batch: ScoringBatch,
    resource: ScoringResource,
    targetDate: string,
    ctx: ScoringContext,
  ): HardViolation[] {
    const violations: HardViolation[] = [];

    // 1. Resource must be active
    if (!resource.active) {
      violations.push("resource_inactive");
    }

    // 2. Capacity: volume must be within resource min/max
    if (batch.batchVolume != null) {
      if (
        resource.minCapacity != null &&
        batch.batchVolume < resource.minCapacity
      ) {
        violations.push("under_capacity");
      }
      if (
        resource.maxCapacity != null &&
        batch.batchVolume > resource.maxCapacity
      ) {
        violations.push("over_capacity");
      }
    }

    // 3. Chemical base must match
    if (resource.chemicalBase != null && batch.chemicalBase != null) {
      if (batch.chemicalBase !== resource.chemicalBase) {
        violations.push("incompatible_base");
      }
    }

    // 4. Resource blocks: resource must not be blocked on target date
    if (this.isResourceBlocked(resource.id, targetDate, ctx.resourceBlocks)) {
      violations.push("resource_blocked");
    }

    // 5. Max batches per day
    if (ctx.dailyBatches.length >= resource.maxBatchesPerDay) {
      violations.push("max_batches_exceeded");
    }

    return violations;
  }

  // -----------------------------------------------------------------------
  // Soft factors
  // -----------------------------------------------------------------------

  private scoreSoftFactors(
    batch: ScoringBatch,
    resource: ScoringResource,
    targetDate: string,
    ctx: ScoringContext,
    w: ScoringWeights,
  ): SoftFactorScore[] {
    const factors: SoftFactorScore[] = [];

    // 1. Colour transition scoring
    factors.push(this.scoreColourTransition(batch, resource, ctx, w));

    // 2. Utilisation sweet-spot
    factors.push(this.scoreUtilisation(batch, resource, w));

    // 3. Trunk line match
    factors.push(this.scoreTrunkLine(batch, resource, ctx, w));

    // 4. Group match
    factors.push(this.scoreGroupMatch(resource, w));

    // 5. Workload balancing
    factors.push(this.scoreWorkloadBalance(resource, ctx, w));

    // 6. WOM/WOP date checks
    factors.push(this.scoreWomCheck(batch, targetDate, w));

    // 7. Substitution rules (positive/negative contribution)
    factors.push(this.scoreSubstitution(batch, resource, ctx));

    return factors;
  }

  /**
   * Score colour transition relative to the last batch on this resource today.
   * Clean light-to-dark = bonus. Dark-to-light requiring washout = penalty.
   */
  private scoreColourTransition(
    batch: ScoringBatch,
    _resource: ScoringResource,
    ctx: ScoringContext,
    w: ScoringWeights,
  ): SoftFactorScore {

    if (ctx.dailyBatches.length === 0 || !batch.sapColorGroup) {
      return {
        factor: "colour_transition",
        raw: 100,
        weight: w.colourCleanBonus / 100,
        weighted: w.colourCleanBonus,
        reason: "No prior batch on resource today – clean start",
      };
    }

    // Last batch on this resource
    const lastBatch = ctx.dailyBatches[ctx.dailyBatches.length - 1]!;
    if (!lastBatch.sapColorGroup) {
      return {
        factor: "colour_transition",
        raw: 50,
        weight: w.colourCleanBonus / 100,
        weighted: (50 * w.colourCleanBonus) / 100,
        reason: "Previous batch has no colour group – neutral",
      };
    }

    const fromGroup = this.findColourGroup(
      lastBatch.sapColorGroup,
      ctx.colourGroups,
    );
    const toGroup = this.findColourGroup(
      batch.sapColorGroup,
      ctx.colourGroups,
    );

    if (!fromGroup || !toGroup) {
      return {
        factor: "colour_transition",
        raw: 50,
        weight: w.colourCleanBonus / 100,
        weighted: (50 * w.colourCleanBonus) / 100,
        reason: "Colour group not found – neutral",
      };
    }

    // Check transition rules
    const transition = ctx.colourTransitions.find(
      (t) => t.fromGroupId === fromGroup.id && t.toGroupId === toGroup.id,
    );

    if (transition && !transition.allowed) {
      // Transition not allowed – heavy penalty
      return {
        factor: "colour_transition",
        raw: 0,
        weight: w.colourWashoutPenalty / 100,
        weighted: -w.colourWashoutPenalty,
        reason: `Transition ${fromGroup.code}→${toGroup.code} not allowed`,
      };
    }

    if (transition?.requiresWashout) {
      // Washout required – penalty
      return {
        factor: "colour_transition",
        raw: 0,
        weight: w.colourWashoutPenalty / 100,
        weighted: -w.colourWashoutPenalty,
        reason: `Washout required for ${fromGroup.code}→${toGroup.code} (${transition.washoutMinutes}min)`,
      };
    }

    // Check direction: light to dark is preferred
    if (toGroup.sortOrder >= fromGroup.sortOrder) {
      return {
        factor: "colour_transition",
        raw: 100,
        weight: w.colourCleanBonus / 100,
        weighted: w.colourCleanBonus,
        reason: `Clean transition ${fromGroup.code}→${toGroup.code} (light to dark)`,
      };
    }

    // Dark to light (no washout required per transition rules, but still less ideal)
    return {
      factor: "colour_transition",
      raw: 30,
      weight: w.colourCleanBonus / 100,
      weighted: (30 * w.colourCleanBonus) / 100,
      reason: `Dark-to-light ${fromGroup.code}→${toGroup.code} – suboptimal sequence`,
    };
  }

  /**
   * Utilisation sweet-spot: batch volume as percentage of max capacity.
   * Optimal utilisation (70–90%) gets highest score.
   */
  private scoreUtilisation(
    batch: ScoringBatch,
    resource: ScoringResource,
    w: ScoringWeights,
  ): SoftFactorScore {
    if (
      batch.batchVolume == null ||
      resource.maxCapacity == null ||
      resource.maxCapacity === 0
    ) {
      return {
        factor: "utilisation",
        raw: 50,
        weight: w.utilisationWeight,
        weighted: 50 * w.utilisationWeight,
        reason: "Cannot calculate utilisation – neutral",
      };
    }

    const util = batch.batchVolume / resource.maxCapacity;
    let raw: number;

    if (util >= 0.7 && util <= 0.9) {
      raw = 100; // Sweet spot
    } else if (util > 0.9) {
      raw = 80; // Near max, still good
    } else if (util >= 0.5) {
      raw = 60; // Moderate
    } else {
      raw = 30; // Under-utilised
    }

    return {
      factor: "utilisation",
      raw,
      weight: w.utilisationWeight,
      weighted: raw * w.utilisationWeight,
      reason: `Utilisation ${Math.round(util * 100)}% → raw ${raw}`,
    };
  }

  /**
   * Trunk line match: bonus only when the batch's source resource trunk line
   * matches the target resource's trunk line. Penalty on mismatch, neutral
   * when either side is unknown.
   */
  private scoreTrunkLine(
    batch: ScoringBatch,
    resource: ScoringResource,
    ctx: ScoringContext,
    w: ScoringWeights,
  ): SoftFactorScore {
    // Target resource has no trunk line → neutral
    if (!resource.trunkLine) {
      return {
        factor: "trunk_line_match",
        raw: 0,
        weight: 1,
        weighted: 0,
        reason: "Resource has no trunk line",
      };
    }

    // Lookup the source resource's trunk line from context map
    const sourceResourceId = batch.planResourceId;
    if (!sourceResourceId || !ctx.resourceTrunkLines) {
      // No source resource or no lookup map → neutral (unknown source)
      return {
        factor: "trunk_line_match",
        raw: 0,
        weight: 1,
        weighted: 0,
        reason: "Source trunk line unknown – neutral",
      };
    }

    const sourceTrunkLine = ctx.resourceTrunkLines[sourceResourceId] ?? null;

    if (sourceTrunkLine == null) {
      // Source resource has no trunk line → neutral
      return {
        factor: "trunk_line_match",
        raw: 0,
        weight: 1,
        weighted: 0,
        reason: "Source resource has no trunk line – neutral",
      };
    }

    if (sourceTrunkLine === resource.trunkLine) {
      // Match → bonus
      return {
        factor: "trunk_line_match",
        raw: w.trunkLineBonus,
        weight: 1,
        weighted: w.trunkLineBonus,
        reason: `Trunk line match ${sourceTrunkLine} → bonus applied`,
      };
    }

    // Mismatch → penalty (half the bonus magnitude as a negative)
    const penalty = Math.round(w.trunkLineBonus / 2);
    return {
      factor: "trunk_line_match",
      raw: 0,
      weight: 1,
      weighted: -penalty,
      reason: `Trunk line mismatch ${sourceTrunkLine}→${resource.trunkLine} – penalty`,
    };
  }

  /**
   * Group match: bonus if the resource's group matches preferences.
   */
  private scoreGroupMatch(
    resource: ScoringResource,
    w: ScoringWeights,
  ): SoftFactorScore {
    if (!resource.groupName) {
      return {
        factor: "group_match",
        raw: 0,
        weight: 1,
        weighted: 0,
        reason: "Resource has no group",
      };
    }

    return {
      factor: "group_match",
      raw: w.groupBonus,
      weight: 1,
      weighted: w.groupBonus,
      reason: `Group ${resource.groupName} – bonus applied`,
    };
  }

  /**
   * Workload balancing: penalise resources that already have many batches
   * relative to the average across all resources.
   */
  private scoreWorkloadBalance(
    resource: ScoringResource,
    ctx: ScoringContext,
    w: ScoringWeights,
  ): SoftFactorScore {

    if (ctx.activeResourceCount <= 1) {
      return {
        factor: "workload_balance",
        raw: 50,
        weight: w.workloadWeight,
        weighted: 50 * w.workloadWeight,
        reason: "Single resource – no balancing needed",
      };
    }

    const totalBatches = ctx.allDailyBatches.length;
    const avgPerResource = totalBatches / ctx.activeResourceCount;
    const currentLoad = ctx.dailyBatches.length;

    let raw: number;
    if (avgPerResource === 0) {
      raw = 100; // No load anywhere, great
    } else {
      const ratio = currentLoad / avgPerResource;
      if (ratio <= 0.5) {
        raw = 100; // Under-loaded, good target
      } else if (ratio <= 1.0) {
        raw = 70; // Near average
      } else if (ratio <= 1.5) {
        raw = 40; // Above average
      } else {
        raw = 10; // Heavily overloaded
      }
    }

    return {
      factor: "workload_balance",
      raw,
      weight: w.workloadWeight,
      weighted: raw * w.workloadWeight,
      reason: `Load ${currentLoad}/${resource.maxBatchesPerDay}, avg ${avgPerResource.toFixed(1)} → raw ${raw}`,
    };
  }

  /**
   * WOM/WOP check: penalise placement if raw materials or packaging
   * are not available by the target date.
   *
   * Uses date-based logic when availability dates are provided:
   * - If rmAvailableDate/packagingAvailableDate is after targetDate → penalty
   * - If on or before targetDate → no penalty
   * Falls back to boolean rmAvailable/packagingAvailable when dates are absent.
   */
  private scoreWomCheck(
    batch: ScoringBatch,
    targetDate: string,
    w: ScoringWeights,
  ): SoftFactorScore {
    const issues: string[] = [];

    // Raw materials check: prefer date-based, fallback to boolean
    if (batch.rmAvailableDate != null) {
      if (batch.rmAvailableDate > targetDate) {
        issues.push(
          `raw materials unavailable until ${batch.rmAvailableDate} (WOM)`,
        );
      }
    } else if (!batch.rmAvailable) {
      issues.push("raw materials unavailable (WOM)");
    }

    // Packaging check: prefer date-based, fallback to boolean
    if (batch.packagingAvailableDate != null) {
      if (batch.packagingAvailableDate > targetDate) {
        issues.push(
          `packaging unavailable until ${batch.packagingAvailableDate} (WOP)`,
        );
      }
    } else if (!batch.packagingAvailable) {
      issues.push("packaging unavailable (WOP)");
    }

    if (issues.length === 0) {
      return {
        factor: "wom_check",
        raw: 100,
        weight: 1,
        weighted: 0, // No penalty
        reason: "Materials and packaging available",
      };
    }

    return {
      factor: "wom_check",
      raw: 0,
      weight: 1,
      weighted: -w.womPenalty * issues.length,
      reason: issues.join("; "),
    };
  }

  /**
   * Substitution rules: soft-factor scoring for cross-resource moves.
   * If the batch is staying on the same resource or has no prior resource,
   * this is neutral (no penalty). If moving to a different resource,
   * matching substitution rules contribute a bonus; no matching rule
   * contributes a penalty.
   */
  private scoreSubstitution(
    batch: ScoringBatch,
    resource: ScoringResource,
    ctx: ScoringContext,
  ): SoftFactorScore {
    const substitutionPenalty = 15;
    const substitutionBonus = 5;

    // Not moving or no prior resource → neutral
    if (
      batch.planResourceId == null ||
      batch.planResourceId === resource.id
    ) {
      return {
        factor: "substitution",
        raw: 50,
        weight: 1,
        weighted: 0,
        reason: "Same resource or no prior assignment – neutral",
      };
    }

    // No substitution rules defined → neutral (unregulated)
    if (ctx.substitutionRules.length === 0) {
      return {
        factor: "substitution",
        raw: 50,
        weight: 1,
        weighted: 0,
        reason: "No substitution rules defined – neutral",
      };
    }

    // Check if any rule allows this substitution
    const allowed = this.isSubstitutionAllowed(
      batch.planResourceId,
      resource.id,
      batch,
      ctx.substitutionRules,
    );

    if (allowed) {
      return {
        factor: "substitution",
        raw: 100,
        weight: 1,
        weighted: substitutionBonus,
        reason: `Substitution ${batch.planResourceId}→${resource.id} allowed by rule`,
      };
    }

    // No matching rule → penalty
    return {
      factor: "substitution",
      raw: 0,
      weight: 1,
      weighted: -substitutionPenalty,
      reason: `No substitution rule allows ${batch.planResourceId}→${resource.id}`,
    };
  }

  // -----------------------------------------------------------------------
  // Helper methods
  // -----------------------------------------------------------------------

  /** Check if a resource is blocked on a given date */
  private isResourceBlocked(
    resourceId: string,
    targetDate: string,
    blocks: { resourceId: string; startDate: string; endDate: string }[],
  ): boolean {
    return blocks.some(
      (b) =>
        b.resourceId === resourceId &&
        targetDate >= b.startDate &&
        targetDate <= b.endDate,
    );
  }

  /** Check if substitution from source to target resource is allowed for this batch */
  private isSubstitutionAllowed(
    sourceResourceId: string,
    targetResourceId: string,
    batch: ScoringBatch,
    rules: {
      sourceResourceId: string | null;
      targetResourceId: string | null;
      conditions: {
        maxVolume?: number;
        minVolume?: number;
        colorGroups?: string[];
      } | null;
      enabled: boolean;
    }[],
  ): boolean {
    return rules.some((rule) => {
      if (!rule.enabled) return false;

      // Match source (null = wildcard)
      if (
        rule.sourceResourceId !== null &&
        rule.sourceResourceId !== sourceResourceId
      ) {
        return false;
      }

      // Match target (null = wildcard)
      if (
        rule.targetResourceId !== null &&
        rule.targetResourceId !== targetResourceId
      ) {
        return false;
      }

      // Check volume conditions
      if (rule.conditions && batch.batchVolume != null) {
        if (
          rule.conditions.maxVolume != null &&
          batch.batchVolume > rule.conditions.maxVolume
        ) {
          return false;
        }
        if (
          rule.conditions.minVolume != null &&
          batch.batchVolume < rule.conditions.minVolume
        ) {
          return false;
        }
      }

      // Check colour group conditions
      if (
        rule.conditions?.colorGroups &&
        rule.conditions.colorGroups.length > 0 &&
        batch.sapColorGroup
      ) {
        if (!rule.conditions.colorGroups.includes(batch.sapColorGroup)) {
          return false;
        }
      }

      return true;
    });
  }

  /** Find a colour group by SAP colour group code */
  private findColourGroup(
    sapColorGroup: string,
    colourGroups: ColourGroup[],
  ): ColourGroup | undefined {
    return colourGroups.find(
      (g) => g.code === sapColorGroup || g.name === sapColorGroup,
    );
  }
}

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

/**
 * Create a PlacementScorer with weights extracted from schedule_rules.
 */
export function createScorer(rules: ScheduleRule[]): PlacementScorer {
  return new PlacementScorer(extractWeights(rules));
}
