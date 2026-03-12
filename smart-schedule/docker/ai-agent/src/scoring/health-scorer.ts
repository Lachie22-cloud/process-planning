// ---------------------------------------------------------------------------
// HealthScorer – deterministic schedule health evaluation engine
// Ported from smart-schedule/src/lib/utils/health-scoring.ts
// ---------------------------------------------------------------------------

import type {
  HealthIssue,
  HealthIssueType,
  HealthIssueSeverity,
  HealthReport,
  HealthScoringContext,
  HealthScoringWeights,
  ScoringBatch,
  ScoringContext,
  ScoringResource,
  SuggestedAction,
} from './types.js';
import { DEFAULT_HEALTH_WEIGHTS } from './types.js';
import { PlacementScorer } from './placement-scorer.js';

// ---------------------------------------------------------------------------
// HealthScorer
// ---------------------------------------------------------------------------

export class HealthScorer {
  readonly placementScorer: PlacementScorer;
  readonly defaultHealthWeights: HealthScoringWeights;

  constructor(
    placementScorer: PlacementScorer,
    defaultHealthWeights: HealthScoringWeights = DEFAULT_HEALTH_WEIGHTS,
  ) {
    this.placementScorer = placementScorer;
    this.defaultHealthWeights = defaultHealthWeights;
  }

  evaluate(ctx: HealthScoringContext): HealthReport {
    const weights: HealthScoringWeights = {
      ...this.defaultHealthWeights,
      ...(ctx.healthWeights ?? {}),
    };

    const issues: HealthIssue[] = [];

    const assignedBatches = ctx.batches.filter(
      (b) => b.planResourceId != null && b.planDate != null,
    );
    const unassignedBatches = ctx.batches.filter(
      (b) => b.planResourceId == null || b.planDate == null,
    );

    const resourceMap = new Map<string, ScoringResource>();
    for (const r of ctx.resources) {
      resourceMap.set(r.id, r);
    }

    const byResourceDate = new Map<string, ScoringBatch[]>();
    for (const batch of assignedBatches) {
      const key = `${batch.planResourceId}|${batch.planDate}`;
      const group = byResourceDate.get(key);
      if (group) {
        group.push(batch);
      } else {
        byResourceDate.set(key, [batch]);
      }
    }

    // 1. Check unassigned batches
    for (const batch of unassignedBatches) {
      issues.push(this.createUnassignedIssue(batch, ctx));
    }

    // 2. Check each resource+date group
    for (const [key, batches] of byResourceDate) {
      const [resourceId, date] = key.split('|') as [string, string];
      const resource = resourceMap.get(resourceId);
      if (!resource) continue;

      // Capacity overload: daily limit
      if (batches.length > resource.maxBatchesPerDay) {
        for (const batch of batches.slice(resource.maxBatchesPerDay)) {
          issues.push(this.createCapacityOverloadIssue(batch, resource, date, ctx));
        }
      }

      // Capacity overload: individual volume
      for (const batch of batches) {
        if (batch.batchVolume != null && resource.maxCapacity != null) {
          if (batch.batchVolume > resource.maxCapacity) {
            issues.push(this.createCapacityOverloadIssue(batch, resource, date, ctx));
          }
        }
      }

      // Under-utilization
      if (resource.maxBatchesPerDay > 0) {
        const utilRatio = batches.length / resource.maxBatchesPerDay;
        if (utilRatio < 0.3 && resource.active) {
          const suggestedAction = this.findBestPlacement(batches[0]!, ctx, resource.id);
          issues.push({
            type: 'under_utilization',
            severity: 'info',
            batchId: batches[0]!.id,
            resourceId: resource.id,
            date,
            message: `Resource ${resource.id} is under-utilized at ${Math.round(utilRatio * 100)}% batch capacity on ${date}`,
            suggestedAction,
          });
        }
      }

      // Colour violations
      this.detectColourViolations(batches, resource, date, ctx, issues);

      // WOM/WOP issues
      for (const batch of batches) {
        this.detectMaterialIssues(batch, resource, date, ctx, issues);
      }
    }

    // 3. Chemical base mismatches
    for (const batch of assignedBatches) {
      const resource = resourceMap.get(batch.planResourceId!);
      if (!resource) continue;
      if (
        batch.chemicalBase != null &&
        resource.chemicalBase != null &&
        batch.chemicalBase !== resource.chemicalBase
      ) {
        issues.push(
          this.createRuleViolationIssue(
            batch,
            resource,
            batch.planDate!,
            `Chemical base mismatch: batch is ${batch.chemicalBase}, resource requires ${resource.chemicalBase}`,
            ctx,
          ),
        );
      }
    }

    // 4. Resource blocks
    for (const batch of assignedBatches) {
      const resource = resourceMap.get(batch.planResourceId!);
      if (!resource) continue;
      const blocked = ctx.resourceBlocks.some(
        (b) =>
          b.resourceId === resource.id &&
          batch.planDate! >= b.startDate &&
          batch.planDate! <= b.endDate,
      );
      if (blocked) {
        issues.push(
          this.createRuleViolationIssue(
            batch,
            resource,
            batch.planDate!,
            `Batch scheduled on blocked resource ${resource.id} on ${batch.planDate}`,
            ctx,
          ),
        );
      }
    }

    // Sort by severity
    const severityOrder: Record<HealthIssueSeverity, number> = {
      critical: 0,
      warning: 1,
      info: 2,
    };
    issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    const deduped = this.deduplicateIssues(issues);
    const issueCounts = this.computeIssueCounts(deduped);
    const score = this.computeScore(issueCounts, weights);

    const totalIssues = deduped.length;
    const criticalCount = deduped.filter((i) => i.severity === 'critical').length;
    const warningCount = deduped.filter((i) => i.severity === 'warning').length;

    let summary: string;
    if (totalIssues === 0) {
      summary = 'Schedule is healthy – no issues detected';
    } else {
      const parts: string[] = [];
      if (criticalCount > 0) parts.push(`${criticalCount} critical`);
      if (warningCount > 0) parts.push(`${warningCount} warning`);
      const infoCount = totalIssues - criticalCount - warningCount;
      if (infoCount > 0) parts.push(`${infoCount} info`);
      summary = `Health score ${score}/100 – ${totalIssues} issue${totalIssues === 1 ? '' : 's'}: ${parts.join(', ')}`;
    }

    return {
      score,
      issues: deduped,
      issueCounts,
      generatedAt: new Date().toISOString(),
      summary,
    };
  }

  // -----------------------------------------------------------------------
  // Issue detection helpers
  // -----------------------------------------------------------------------

  private createUnassignedIssue(batch: ScoringBatch, ctx: HealthScoringContext): HealthIssue {
    const suggestedAction = this.findBestPlacement(batch, ctx);
    return {
      type: 'unassigned',
      severity: 'critical',
      batchId: batch.id,
      resourceId: null,
      date: null,
      message: `Batch ${batch.id} is not assigned to any resource`,
      suggestedAction,
    };
  }

  private createCapacityOverloadIssue(
    batch: ScoringBatch,
    resource: ScoringResource,
    date: string,
    ctx: HealthScoringContext,
  ): HealthIssue {
    const suggestedAction = this.findBestPlacement(batch, ctx, resource.id);
    return {
      type: 'capacity_overload',
      severity: 'critical',
      batchId: batch.id,
      resourceId: resource.id,
      date,
      message: `Resource ${resource.id} is overloaded on ${date}`,
      suggestedAction,
    };
  }

  private createRuleViolationIssue(
    batch: ScoringBatch,
    resource: ScoringResource,
    date: string,
    message: string,
    ctx: HealthScoringContext,
  ): HealthIssue {
    const suggestedAction = this.findBestPlacement(batch, ctx, resource.id);
    return {
      type: 'rule_violation',
      severity: 'warning',
      batchId: batch.id,
      resourceId: resource.id,
      date,
      message,
      suggestedAction,
    };
  }

  private detectColourViolations(
    batches: ScoringBatch[],
    resource: ScoringResource,
    date: string,
    ctx: HealthScoringContext,
    issues: HealthIssue[],
  ): void {
    for (let i = 1; i < batches.length; i++) {
      const prev = batches[i - 1]!;
      const curr = batches[i]!;

      if (!prev.sapColorGroup || !curr.sapColorGroup) continue;

      const fromGroup = ctx.colourGroups.find(
        (g) => g.code === prev.sapColorGroup || g.name === prev.sapColorGroup,
      );
      const toGroup = ctx.colourGroups.find(
        (g) => g.code === curr.sapColorGroup || g.name === curr.sapColorGroup,
      );

      if (!fromGroup || !toGroup) continue;

      const transition = ctx.colourTransitions.find(
        (t) => t.fromGroupId === fromGroup.id && t.toGroupId === toGroup.id,
      );

      if (transition && !transition.allowed) {
        const suggestedAction = this.findBestPlacement(curr, ctx, resource.id);
        issues.push({
          type: 'colour_violation',
          severity: 'warning',
          batchId: curr.id,
          resourceId: resource.id,
          date,
          message: `Colour transition ${fromGroup.code}→${toGroup.code} not allowed on resource ${resource.id}`,
          suggestedAction,
        });
      }
    }
  }

  private detectMaterialIssues(
    batch: ScoringBatch,
    resource: ScoringResource,
    date: string,
    ctx: HealthScoringContext,
    issues: HealthIssue[],
  ): void {
    // WOM check
    let rmUnavailable = false;
    if (batch.rmAvailableDate != null) {
      rmUnavailable = batch.rmAvailableDate > date;
    } else {
      rmUnavailable = !batch.rmAvailable;
    }

    if (rmUnavailable) {
      const suggestedAction = this.findBestPlacementForDateShift(batch, ctx, batch.rmAvailableDate ?? null);
      issues.push({
        type: 'wom',
        severity: 'warning',
        batchId: batch.id,
        resourceId: resource.id,
        date,
        message: batch.rmAvailableDate
          ? `Raw materials unavailable until ${batch.rmAvailableDate} (scheduled ${date})`
          : `Raw materials unavailable for batch ${batch.id}`,
        suggestedAction,
      });
    }

    // WOP check
    let packUnavailable = false;
    if (batch.packagingAvailableDate != null) {
      packUnavailable = batch.packagingAvailableDate > date;
    } else {
      packUnavailable = !batch.packagingAvailable;
    }

    if (packUnavailable) {
      const suggestedAction = this.findBestPlacementForDateShift(batch, ctx, batch.packagingAvailableDate ?? null);
      issues.push({
        type: 'wop',
        severity: 'warning',
        batchId: batch.id,
        resourceId: resource.id,
        date,
        message: batch.packagingAvailableDate
          ? `Packaging unavailable until ${batch.packagingAvailableDate} (scheduled ${date})`
          : `Packaging unavailable for batch ${batch.id}`,
        suggestedAction,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Suggested action helpers
  // -----------------------------------------------------------------------

  private findBestPlacement(
    batch: ScoringBatch,
    ctx: HealthScoringContext,
    excludeResourceId?: string,
  ): SuggestedAction | null {
    const targetDate = batch.planDate ?? ctx.evaluationDate ?? new Date().toISOString().slice(0, 10);
    const activeResources = ctx.resources.filter((r) => r.active && r.id !== excludeResourceId);

    if (activeResources.length === 0) return null;

    let bestScore = -Infinity;
    let bestAction: SuggestedAction | null = null;

    const batchesByResource = this.groupBatchesByResourceDate(ctx.batches);
    const allDailyBatches = ctx.batches.filter((b) => b.planDate === targetDate);

    for (const resource of activeResources) {
      const dailyKey = `${resource.id}|${targetDate}`;
      const dailyBatches = batchesByResource.get(dailyKey) ?? [];

      const scoringCtx: ScoringContext = {
        dailyBatches,
        allDailyBatches,
        resourceBlocks: ctx.resourceBlocks,
        colourTransitions: ctx.colourTransitions,
        colourGroups: ctx.colourGroups,
        substitutionRules: ctx.substitutionRules,
        activeResourceCount: activeResources.length + (excludeResourceId ? 1 : 0),
        resourceTrunkLines: ctx.resourceTrunkLines,
      };

      const result = this.placementScorer.score(batch, resource, targetDate, scoringCtx);

      if (result.feasible && result.score > bestScore) {
        bestScore = result.score;
        bestAction = {
          targetResourceId: resource.id,
          targetDate,
          placementScore: result.score,
          description: `Move to ${resource.id} on ${targetDate} (score: ${result.score})`,
        };
      }
    }

    return bestAction;
  }

  private findBestPlacementForDateShift(
    batch: ScoringBatch,
    ctx: HealthScoringContext,
    requiredDate: string | null,
  ): SuggestedAction | null {
    if (!requiredDate) {
      return this.findBestPlacement(batch, ctx);
    }

    const targetDate = requiredDate;
    const activeResources = ctx.resources.filter((r) => r.active);
    if (activeResources.length === 0) return null;

    let bestScore = -Infinity;
    let bestAction: SuggestedAction | null = null;

    const batchesByResource = this.groupBatchesByResourceDate(ctx.batches);
    const allDailyBatches = ctx.batches.filter((b) => b.planDate === targetDate);

    for (const resource of activeResources) {
      const dailyKey = `${resource.id}|${targetDate}`;
      const dailyBatches = batchesByResource.get(dailyKey) ?? [];

      const scoringCtx: ScoringContext = {
        dailyBatches,
        allDailyBatches,
        resourceBlocks: ctx.resourceBlocks,
        colourTransitions: ctx.colourTransitions,
        colourGroups: ctx.colourGroups,
        substitutionRules: ctx.substitutionRules,
        activeResourceCount: activeResources.length,
        resourceTrunkLines: ctx.resourceTrunkLines,
      };

      const result = this.placementScorer.score(batch, resource, targetDate, scoringCtx);

      if (result.feasible && result.score > bestScore) {
        bestScore = result.score;
        bestAction = {
          targetResourceId: resource.id,
          targetDate,
          placementScore: result.score,
          description: `Reschedule to ${resource.id} on ${targetDate} when materials available (score: ${result.score})`,
        };
      }
    }

    return bestAction;
  }

  // -----------------------------------------------------------------------
  // Score computation
  // -----------------------------------------------------------------------

  computeScore(issueCounts: Record<HealthIssueType, number>, weights: HealthScoringWeights): number {
    let deduction = 0;
    for (const type of Object.keys(weights) as HealthIssueType[]) {
      deduction += weights[type] * (issueCounts[type] ?? 0);
    }
    return Math.max(5, Math.min(100, 100 - deduction));
  }

  // -----------------------------------------------------------------------
  // Utility methods
  // -----------------------------------------------------------------------

  private computeIssueCounts(issues: HealthIssue[]): Record<HealthIssueType, number> {
    const counts: Record<HealthIssueType, number> = {
      capacity_overload: 0,
      colour_violation: 0,
      wom: 0,
      wop: 0,
      under_utilization: 0,
      unassigned: 0,
      rule_violation: 0,
    };
    for (const issue of issues) {
      counts[issue.type]++;
    }
    return counts;
  }

  private deduplicateIssues(issues: HealthIssue[]): HealthIssue[] {
    const severityRank: Record<HealthIssueSeverity, number> = {
      critical: 0,
      warning: 1,
      info: 2,
    };

    const seen = new Map<string, HealthIssue>();
    for (const issue of issues) {
      const key = `${issue.batchId}|${issue.type}`;
      const existing = seen.get(key);
      if (!existing || severityRank[issue.severity] < severityRank[existing.severity]) {
        seen.set(key, issue);
      }
    }
    return Array.from(seen.values());
  }

  private groupBatchesByResourceDate(batches: ScoringBatch[]): Map<string, ScoringBatch[]> {
    const map = new Map<string, ScoringBatch[]>();
    for (const batch of batches) {
      if (batch.planResourceId == null || batch.planDate == null) continue;
      const key = `${batch.planResourceId}|${batch.planDate}`;
      const group = map.get(key);
      if (group) {
        group.push(batch);
      } else {
        map.set(key, [batch]);
      }
    }
    return map;
  }
}
