// ---------------------------------------------------------------------------
// HealthScorer – deterministic schedule health evaluation engine
// ---------------------------------------------------------------------------
// Pure functions: same input → identical output, no side effects.
// Evaluates a schedule snapshot and produces a HealthReport with typed issues,
// severity levels, and suggested corrective actions via PlacementScorer.
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
} from "@/types/scoring";
import { DEFAULT_HEALTH_WEIGHTS } from "@/types/scoring";
import { PlacementScorer } from "@/lib/utils/placement-scoring";

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

  /**
   * Evaluate the health of a schedule snapshot.
   * Returns a HealthReport with score (5–100), issues, and suggested actions.
   *
   * Formula: score = 100 - Σ(weight[issueType] * count[issueType]), clamped to [5, 100]
   */
  evaluate(ctx: HealthScoringContext): HealthReport {
    const weights: HealthScoringWeights = {
      ...this.defaultHealthWeights,
      ...(ctx.healthWeights ?? {}),
    };

    const issues: HealthIssue[] = [];

    // Group batches by resource+date for efficient analysis
    const assignedBatches = ctx.batches.filter(
      (b) => b.planResourceId != null && b.planDate != null,
    );
    const unassignedBatches = ctx.batches.filter(
      (b) => b.planResourceId == null || b.planDate == null,
    );

    // Build resource lookup
    const resourceMap = new Map<string, ScoringResource>();
    for (const r of ctx.resources) {
      resourceMap.set(r.id, r);
    }

    // Group assigned batches by resourceId+date
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
      issues.push(
        this.createUnassignedIssue(batch, ctx),
      );
    }

    // 2. Check each resource+date group
    for (const [key, batches] of byResourceDate) {
      const [resourceId, date] = key.split("|") as [string, string];
      const resource = resourceMap.get(resourceId);
      if (!resource) continue;

      // 2a. Capacity overload
      if (batches.length > resource.maxBatchesPerDay) {
        for (const batch of batches.slice(resource.maxBatchesPerDay)) {
          issues.push(
            this.createCapacityOverloadIssue(batch, resource, date, ctx),
          );
        }
      }

      // 2b. Individual batch volume capacity checks
      for (const batch of batches) {
        if (batch.batchVolume != null && resource.maxCapacity != null) {
          if (batch.batchVolume > resource.maxCapacity) {
            issues.push(
              this.createCapacityOverloadIssue(batch, resource, date, ctx),
            );
          }
        }
      }

      // 2c. Under-utilization: resource has very low load relative to capacity
      if (resource.maxBatchesPerDay > 0) {
        const utilRatio = batches.length / resource.maxBatchesPerDay;
        if (utilRatio < 0.3 && resource.active) {
          // Try to find a better-utilized resource to consolidate this batch onto
          const suggestedAction = this.findBestPlacement(batches[0]!, ctx, resource.id);
          issues.push({
            type: "under_utilization",
            severity: "info",
            batchId: batches[0]!.id,
            resourceId: resource.id,
            date,
            message: `Resource ${resource.id} is under-utilized at ${Math.round(utilRatio * 100)}% batch capacity on ${date}`,
            suggestedAction,
          });
        }
      }

      // 2d. Colour violations: check sequence
      this.detectColourViolations(batches, resource, date, ctx, issues);

      // 2e. WOM/WOP issues per batch
      for (const batch of batches) {
        this.detectMaterialIssues(batch, resource, date, ctx, issues);
      }
    }

    // 3. Rule violations: check chemical base mismatches on assigned batches
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

    // 4. Rule violations: check resource blocks
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

    // Sort issues: critical first, then warning, then info
    const severityOrder: Record<HealthIssueSeverity, number> = {
      critical: 0,
      warning: 1,
      info: 2,
    };
    issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    // Deduplicate: avoid double-counting same batch+type
    const deduped = this.deduplicateIssues(issues);

    // Compute issue counts
    const issueCounts = this.computeIssueCounts(deduped);

    // Compute score: 100 - Σ(weight * count), clamped to [5, 100]
    const score = this.computeScore(issueCounts, weights);

    // Build summary
    const totalIssues = deduped.length;
    const criticalCount = deduped.filter((i) => i.severity === "critical").length;
    const warningCount = deduped.filter((i) => i.severity === "warning").length;

    let summary: string;
    if (totalIssues === 0) {
      summary = "Schedule is healthy – no issues detected";
    } else {
      const parts: string[] = [];
      if (criticalCount > 0) parts.push(`${criticalCount} critical`);
      if (warningCount > 0) parts.push(`${warningCount} warning`);
      const infoCount = totalIssues - criticalCount - warningCount;
      if (infoCount > 0) parts.push(`${infoCount} info`);
      summary = `Health score ${score}/100 – ${totalIssues} issue${totalIssues === 1 ? "" : "s"}: ${parts.join(", ")}`;
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

  private createUnassignedIssue(
    batch: ScoringBatch,
    ctx: HealthScoringContext,
  ): HealthIssue {
    const suggestedAction = this.findBestPlacement(batch, ctx);
    return {
      type: "unassigned",
      severity: "critical",
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
      type: "capacity_overload",
      severity: "critical",
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
      type: "rule_violation",
      severity: "warning",
      batchId: batch.id,
      resourceId: resource.id,
      date,
      message,
      suggestedAction,
    };
  }

  /**
   * Detect colour violations in a batch sequence on a resource for a given date.
   * Checks the colour transition rules between consecutive batches.
   */
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
          type: "colour_violation",
          severity: "warning",
          batchId: curr.id,
          resourceId: resource.id,
          date,
          message: `Colour transition ${fromGroup.code}→${toGroup.code} not allowed on resource ${resource.id}`,
          suggestedAction,
        });
      }
    }
  }

  /**
   * Detect WOM (raw materials) and WOP (packaging) availability issues.
   * Each issue type passes its own required date to the date-shift helper
   * so the suggested action targets the correct availability date.
   */
  private detectMaterialIssues(
    batch: ScoringBatch,
    resource: ScoringResource,
    date: string,
    ctx: HealthScoringContext,
    issues: HealthIssue[],
  ): void {
    // WOM check: raw materials
    let rmUnavailable = false;
    if (batch.rmAvailableDate != null) {
      rmUnavailable = batch.rmAvailableDate > date;
    } else {
      rmUnavailable = !batch.rmAvailable;
    }

    if (rmUnavailable) {
      const suggestedAction = this.findBestPlacementForDateShift(
        batch,
        ctx,
        batch.rmAvailableDate ?? null,
      );
      issues.push({
        type: "wom",
        severity: "warning",
        batchId: batch.id,
        resourceId: resource.id,
        date,
        message: batch.rmAvailableDate
          ? `Raw materials unavailable until ${batch.rmAvailableDate} (scheduled ${date})`
          : `Raw materials unavailable for batch ${batch.id}`,
        suggestedAction,
      });
    }

    // WOP check: packaging
    let packUnavailable = false;
    if (batch.packagingAvailableDate != null) {
      packUnavailable = batch.packagingAvailableDate > date;
    } else {
      packUnavailable = !batch.packagingAvailable;
    }

    if (packUnavailable) {
      const suggestedAction = this.findBestPlacementForDateShift(
        batch,
        ctx,
        batch.packagingAvailableDate ?? null,
      );
      issues.push({
        type: "wop",
        severity: "warning",
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
  // Suggested action helpers (use PlacementScorer)
  // -----------------------------------------------------------------------

  /**
   * Find the best alternative placement for a batch across all active resources.
   * Uses the PlacementScorer to evaluate each candidate and returns the highest-scoring one.
   */
  private findBestPlacement(
    batch: ScoringBatch,
    ctx: HealthScoringContext,
    excludeResourceId?: string,
  ): SuggestedAction | null {
    const targetDate = batch.planDate ?? ctx.evaluationDate ?? new Date().toISOString().slice(0, 10);
    const activeResources = ctx.resources.filter(
      (r) => r.active && r.id !== excludeResourceId,
    );

    if (activeResources.length === 0) return null;

    let bestScore = -Infinity;
    let bestAction: SuggestedAction | null = null;

    // Build batches-by-resource map for context
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

  /**
   * For WOM/WOP issues, try to find a placement on a later date when materials are available.
   * The caller passes the issue-specific requiredDate so WOM uses rmAvailableDate and
   * WOP uses packagingAvailableDate — avoiding the bug where WOP suggestions incorrectly
   * target the earlier RM date.
   */
  private findBestPlacementForDateShift(
    batch: ScoringBatch,
    ctx: HealthScoringContext,
    requiredDate: string | null,
  ): SuggestedAction | null {
    if (!requiredDate) {
      // No date info → try same resource, just find best placement
      return this.findBestPlacement(batch, ctx);
    }

    const matDate = requiredDate;

    // Try placing on the earliest material-available date
    const targetDate = matDate;
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

  /**
   * Compute health score: 100 - Σ(weight[type] * count[type]), clamped to [5, 100].
   */
  computeScore(
    issueCounts: Record<HealthIssueType, number>,
    weights: HealthScoringWeights,
  ): number {
    let deduction = 0;
    for (const type of Object.keys(weights) as HealthIssueType[]) {
      deduction += weights[type] * (issueCounts[type] ?? 0);
    }
    return Math.max(5, Math.min(100, 100 - deduction));
  }

  // -----------------------------------------------------------------------
  // Utility methods
  // -----------------------------------------------------------------------

  private computeIssueCounts(
    issues: HealthIssue[],
  ): Record<HealthIssueType, number> {
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

  /**
   * Deduplicate issues by batch+type to avoid double-counting.
   * Keeps the highest-severity instance for each batch+type pair.
   */
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

  private groupBatchesByResourceDate(
    batches: ScoringBatch[],
  ): Map<string, ScoringBatch[]> {
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

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

/**
 * Create a HealthScorer with a pre-configured PlacementScorer.
 */
export function createHealthScorer(
  placementScorer: PlacementScorer,
  healthWeights?: HealthScoringWeights,
): HealthScorer {
  return new HealthScorer(placementScorer, healthWeights);
}
