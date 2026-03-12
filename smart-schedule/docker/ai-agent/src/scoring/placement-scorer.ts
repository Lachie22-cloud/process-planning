// ---------------------------------------------------------------------------
// PlacementScorer – deterministic placement evaluation engine
// Ported from smart-schedule/src/lib/utils/placement-scoring.ts
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
} from './types.js';
import { DEFAULT_SCORING_WEIGHTS } from './types.js';

// ---------------------------------------------------------------------------
// Weight extraction from schedule_rules
// ---------------------------------------------------------------------------

interface ScheduleRuleLike {
  enabled: boolean;
  conditions: Record<string, unknown> | null;
  actions: Record<string, unknown> | null;
}

export function extractWeights(rules: ScheduleRuleLike[]): ScoringWeights {
  const weights = { ...DEFAULT_SCORING_WEIGHTS };
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const actions = rule.actions;
    if (!actions) continue;

    const conditions = rule.conditions;
    const preference = (conditions as Record<string, unknown> | null)?.preference as string | undefined;
    const bonus = actions.score_bonus as number | undefined;

    if (preference === 'same_trunk_line' && typeof bonus === 'number') {
      weights.trunkLineBonus = bonus;
    }
    if (preference === 'same_group' && typeof bonus === 'number') {
      weights.groupBonus = bonus;
    }
    if (typeof actions.colourWashoutPenalty === 'number') {
      weights.colourWashoutPenalty = actions.colourWashoutPenalty;
    }
    if (typeof actions.colourCleanBonus === 'number') {
      weights.colourCleanBonus = actions.colourCleanBonus;
    }
    if (typeof actions.utilisationWeight === 'number') {
      weights.utilisationWeight = actions.utilisationWeight;
    }
    if (typeof actions.workloadWeight === 'number') {
      weights.workloadWeight = actions.workloadWeight;
    }
    if (typeof actions.womPenalty === 'number') {
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

  score(
    batch: ScoringBatch,
    resource: ScoringResource,
    targetDate: string,
    ctx: ScoringContext,
  ): PlacementScore {
    const effectiveWeights: ScoringWeights = {
      ...this.defaultWeights,
      ...(ctx.weights ?? {}),
    };

    const violations = this.checkHardConstraints(batch, resource, targetDate, ctx);
    if (violations.length > 0) {
      return {
        score: 0,
        feasible: false,
        violations,
        factors: [],
        summary: `Blocked: ${violations.join(', ')}`,
      };
    }

    const factors = this.scoreSoftFactors(batch, resource, targetDate, ctx, effectiveWeights);
    const total = factors.reduce((sum, f) => sum + f.weighted, 0);

    return {
      score: Math.max(0, Math.round(total * 100) / 100),
      feasible: true,
      violations: [],
      factors,
      summary: `Score ${Math.round(total)}: ${factors.map((f) => `${f.factor}=${f.weighted}`).join(', ')}`,
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

    if (!resource.active) {
      violations.push('resource_inactive');
    }

    if (batch.batchVolume != null) {
      if (resource.minCapacity != null && batch.batchVolume < resource.minCapacity) {
        violations.push('under_capacity');
      }
      if (resource.maxCapacity != null && batch.batchVolume > resource.maxCapacity) {
        violations.push('over_capacity');
      }
    }

    if (resource.chemicalBase != null && batch.chemicalBase != null) {
      if (batch.chemicalBase !== resource.chemicalBase) {
        violations.push('incompatible_base');
      }
    }

    if (this.isResourceBlocked(resource.id, targetDate, ctx.resourceBlocks)) {
      violations.push('resource_blocked');
    }

    if (ctx.dailyBatches.length >= resource.maxBatchesPerDay) {
      violations.push('max_batches_exceeded');
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
    return [
      this.scoreColourTransition(batch, ctx, w),
      this.scoreUtilisation(batch, resource, w),
      this.scoreTrunkLine(batch, resource, ctx, w),
      this.scoreGroupMatch(resource, w),
      this.scoreWorkloadBalance(resource, ctx, w),
      this.scoreWomCheck(batch, targetDate, w),
      this.scoreSubstitution(batch, resource, ctx),
    ];
  }

  private scoreColourTransition(
    batch: ScoringBatch,
    ctx: ScoringContext,
    w: ScoringWeights,
  ): SoftFactorScore {
    if (ctx.dailyBatches.length === 0 || !batch.sapColorGroup) {
      return {
        factor: 'colour_transition',
        raw: 100,
        weight: w.colourCleanBonus / 100,
        weighted: w.colourCleanBonus,
        reason: 'No prior batch on resource today – clean start',
      };
    }

    const lastBatch = ctx.dailyBatches[ctx.dailyBatches.length - 1]!;
    if (!lastBatch.sapColorGroup) {
      return {
        factor: 'colour_transition',
        raw: 50,
        weight: w.colourCleanBonus / 100,
        weighted: (50 * w.colourCleanBonus) / 100,
        reason: 'Previous batch has no colour group – neutral',
      };
    }

    const fromGroup = this.findColourGroup(lastBatch.sapColorGroup, ctx.colourGroups);
    const toGroup = this.findColourGroup(batch.sapColorGroup, ctx.colourGroups);

    if (!fromGroup || !toGroup) {
      return {
        factor: 'colour_transition',
        raw: 50,
        weight: w.colourCleanBonus / 100,
        weighted: (50 * w.colourCleanBonus) / 100,
        reason: 'Colour group not found – neutral',
      };
    }

    const transition = ctx.colourTransitions.find(
      (t) => t.fromGroupId === fromGroup.id && t.toGroupId === toGroup.id,
    );

    if (transition && !transition.allowed) {
      return {
        factor: 'colour_transition',
        raw: 0,
        weight: w.colourWashoutPenalty / 100,
        weighted: -w.colourWashoutPenalty,
        reason: `Transition ${fromGroup.code}→${toGroup.code} not allowed`,
      };
    }

    if (transition?.requiresWashout) {
      return {
        factor: 'colour_transition',
        raw: 0,
        weight: w.colourWashoutPenalty / 100,
        weighted: -w.colourWashoutPenalty,
        reason: `Washout required for ${fromGroup.code}→${toGroup.code} (${transition.washoutMinutes}min)`,
      };
    }

    if (toGroup.sortOrder >= fromGroup.sortOrder) {
      return {
        factor: 'colour_transition',
        raw: 100,
        weight: w.colourCleanBonus / 100,
        weighted: w.colourCleanBonus,
        reason: `Clean transition ${fromGroup.code}→${toGroup.code} (light to dark)`,
      };
    }

    return {
      factor: 'colour_transition',
      raw: 30,
      weight: w.colourCleanBonus / 100,
      weighted: (30 * w.colourCleanBonus) / 100,
      reason: `Dark-to-light ${fromGroup.code}→${toGroup.code} – suboptimal sequence`,
    };
  }

  private scoreUtilisation(
    batch: ScoringBatch,
    resource: ScoringResource,
    w: ScoringWeights,
  ): SoftFactorScore {
    if (batch.batchVolume == null || resource.maxCapacity == null || resource.maxCapacity === 0) {
      return {
        factor: 'utilisation',
        raw: 50,
        weight: w.utilisationWeight,
        weighted: 50 * w.utilisationWeight,
        reason: 'Cannot calculate utilisation – neutral',
      };
    }

    const util = batch.batchVolume / resource.maxCapacity;
    let raw: number;
    if (util >= 0.7 && util <= 0.9) {
      raw = 100;
    } else if (util > 0.9) {
      raw = 80;
    } else if (util >= 0.5) {
      raw = 60;
    } else {
      raw = 30;
    }

    return {
      factor: 'utilisation',
      raw,
      weight: w.utilisationWeight,
      weighted: raw * w.utilisationWeight,
      reason: `Utilisation ${Math.round(util * 100)}% → raw ${raw}`,
    };
  }

  private scoreTrunkLine(
    batch: ScoringBatch,
    resource: ScoringResource,
    ctx: ScoringContext,
    w: ScoringWeights,
  ): SoftFactorScore {
    if (!resource.trunkLine) {
      return { factor: 'trunk_line_match', raw: 0, weight: 1, weighted: 0, reason: 'Resource has no trunk line' };
    }

    const sourceResourceId = batch.planResourceId;
    if (!sourceResourceId || !ctx.resourceTrunkLines) {
      return { factor: 'trunk_line_match', raw: 0, weight: 1, weighted: 0, reason: 'Source trunk line unknown – neutral' };
    }

    const sourceTrunkLine = ctx.resourceTrunkLines[sourceResourceId] ?? null;
    if (sourceTrunkLine == null) {
      return { factor: 'trunk_line_match', raw: 0, weight: 1, weighted: 0, reason: 'Source resource has no trunk line – neutral' };
    }

    if (sourceTrunkLine === resource.trunkLine) {
      return {
        factor: 'trunk_line_match',
        raw: w.trunkLineBonus,
        weight: 1,
        weighted: w.trunkLineBonus,
        reason: `Trunk line match ${sourceTrunkLine} → bonus applied`,
      };
    }

    const penalty = Math.round(w.trunkLineBonus / 2);
    return {
      factor: 'trunk_line_match',
      raw: 0,
      weight: 1,
      weighted: -penalty,
      reason: `Trunk line mismatch ${sourceTrunkLine}→${resource.trunkLine} – penalty`,
    };
  }

  private scoreGroupMatch(resource: ScoringResource, w: ScoringWeights): SoftFactorScore {
    if (!resource.groupName) {
      return { factor: 'group_match', raw: 0, weight: 1, weighted: 0, reason: 'Resource has no group' };
    }
    return {
      factor: 'group_match',
      raw: w.groupBonus,
      weight: 1,
      weighted: w.groupBonus,
      reason: `Group ${resource.groupName} – bonus applied`,
    };
  }

  private scoreWorkloadBalance(
    resource: ScoringResource,
    ctx: ScoringContext,
    w: ScoringWeights,
  ): SoftFactorScore {
    if (ctx.activeResourceCount <= 1) {
      return {
        factor: 'workload_balance',
        raw: 50,
        weight: w.workloadWeight,
        weighted: 50 * w.workloadWeight,
        reason: 'Single resource – no balancing needed',
      };
    }

    const totalBatches = ctx.allDailyBatches.length;
    const avgPerResource = totalBatches / ctx.activeResourceCount;
    const currentLoad = ctx.dailyBatches.length;

    let raw: number;
    if (avgPerResource === 0) {
      raw = 100;
    } else {
      const ratio = currentLoad / avgPerResource;
      if (ratio <= 0.5) raw = 100;
      else if (ratio <= 1.0) raw = 70;
      else if (ratio <= 1.5) raw = 40;
      else raw = 10;
    }

    return {
      factor: 'workload_balance',
      raw,
      weight: w.workloadWeight,
      weighted: raw * w.workloadWeight,
      reason: `Load ${currentLoad}/${resource.maxBatchesPerDay}, avg ${avgPerResource.toFixed(1)} → raw ${raw}`,
    };
  }

  private scoreWomCheck(batch: ScoringBatch, targetDate: string, w: ScoringWeights): SoftFactorScore {
    const issues: string[] = [];

    if (batch.rmAvailableDate != null) {
      if (batch.rmAvailableDate > targetDate) {
        issues.push(`raw materials unavailable until ${batch.rmAvailableDate} (WOM)`);
      }
    } else if (!batch.rmAvailable) {
      issues.push('raw materials unavailable (WOM)');
    }

    if (batch.packagingAvailableDate != null) {
      if (batch.packagingAvailableDate > targetDate) {
        issues.push(`packaging unavailable until ${batch.packagingAvailableDate} (WOP)`);
      }
    } else if (!batch.packagingAvailable) {
      issues.push('packaging unavailable (WOP)');
    }

    if (issues.length === 0) {
      return { factor: 'wom_check', raw: 100, weight: 1, weighted: 0, reason: 'Materials and packaging available' };
    }

    return {
      factor: 'wom_check',
      raw: 0,
      weight: 1,
      weighted: -w.womPenalty * issues.length,
      reason: issues.join('; '),
    };
  }

  private scoreSubstitution(
    batch: ScoringBatch,
    resource: ScoringResource,
    ctx: ScoringContext,
  ): SoftFactorScore {
    const substitutionPenalty = 15;
    const substitutionBonus = 5;

    if (batch.planResourceId == null || batch.planResourceId === resource.id) {
      return { factor: 'substitution', raw: 50, weight: 1, weighted: 0, reason: 'Same resource or no prior assignment – neutral' };
    }

    if (ctx.substitutionRules.length === 0) {
      return { factor: 'substitution', raw: 50, weight: 1, weighted: 0, reason: 'No substitution rules defined – neutral' };
    }

    const allowed = this.isSubstitutionAllowed(batch.planResourceId, resource.id, batch, ctx.substitutionRules);

    if (allowed) {
      return {
        factor: 'substitution',
        raw: 100,
        weight: 1,
        weighted: substitutionBonus,
        reason: `Substitution ${batch.planResourceId}→${resource.id} allowed by rule`,
      };
    }

    return {
      factor: 'substitution',
      raw: 0,
      weight: 1,
      weighted: -substitutionPenalty,
      reason: `No substitution rule allows ${batch.planResourceId}→${resource.id}`,
    };
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private isResourceBlocked(
    resourceId: string,
    targetDate: string,
    blocks: { resourceId: string; startDate: string; endDate: string }[],
  ): boolean {
    return blocks.some(
      (b) => b.resourceId === resourceId && targetDate >= b.startDate && targetDate <= b.endDate,
    );
  }

  private isSubstitutionAllowed(
    sourceResourceId: string,
    targetResourceId: string,
    batch: ScoringBatch,
    rules: {
      sourceResourceId: string | null;
      targetResourceId: string | null;
      conditions: { maxVolume?: number; minVolume?: number; colorGroups?: string[] } | null;
      enabled: boolean;
    }[],
  ): boolean {
    return rules.some((rule) => {
      if (!rule.enabled) return false;
      if (rule.sourceResourceId !== null && rule.sourceResourceId !== sourceResourceId) return false;
      if (rule.targetResourceId !== null && rule.targetResourceId !== targetResourceId) return false;

      if (rule.conditions && batch.batchVolume != null) {
        if (rule.conditions.maxVolume != null && batch.batchVolume > rule.conditions.maxVolume) return false;
        if (rule.conditions.minVolume != null && batch.batchVolume < rule.conditions.minVolume) return false;
      }

      if (rule.conditions?.colorGroups && rule.conditions.colorGroups.length > 0 && batch.sapColorGroup) {
        if (!rule.conditions.colorGroups.includes(batch.sapColorGroup)) return false;
      }

      return true;
    });
  }

  private findColourGroup(sapColorGroup: string, colourGroups: ColourGroup[]): ColourGroup | undefined {
    return colourGroups.find((g) => g.code === sapColorGroup || g.name === sapColorGroup);
  }
}
