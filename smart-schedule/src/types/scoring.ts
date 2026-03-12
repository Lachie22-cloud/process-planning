// ---------------------------------------------------------------------------
// Scoring types for deterministic placement and health evaluation
// ---------------------------------------------------------------------------

/** Machine-readable reason codes for placement decisions */
export type HardViolation =
  | "under_capacity"
  | "over_capacity"
  | "incompatible_base"
  | "resource_blocked"
  | "max_batches_exceeded"
  | "resource_inactive";

/** Soft-factor identifiers used in score breakdowns */
export type SoftFactor =
  | "colour_transition"
  | "utilisation"
  | "trunk_line_match"
  | "group_match"
  | "workload_balance"
  | "wom_check"
  | "substitution";

/** A single scored soft factor with weight, raw value, and weighted contribution */
export interface SoftFactorScore {
  factor: SoftFactor;
  /** Raw score before weighting (0–100 scale) */
  raw: number;
  /** Weight applied (from schedule_rules or defaults) */
  weight: number;
  /** raw * weight */
  weighted: number;
  /** Human-readable explanation */
  reason: string;
}

/** Result of scoring a single placement */
export interface PlacementScore {
  /** Final composite score. 0 = blocked by hard constraint. */
  score: number;
  /** True if placement passes all hard constraints */
  feasible: boolean;
  /** Hard violations that block this placement (empty if feasible) */
  violations: HardViolation[];
  /** Individual soft factor contributions (only meaningful if feasible) */
  factors: SoftFactorScore[];
  /** Human-readable one-line summary */
  summary: string;
}

/** Colour group info used in transition scoring */
export interface ColourGroup {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
}

/** Transition rule between two colour groups */
export interface ColourTransition {
  fromGroupId: string;
  toGroupId: string;
  allowed: boolean;
  requiresWashout: boolean;
  washoutMinutes: number;
}

/** Scoring weights derived from schedule_rules actions */
export interface ScoringWeights {
  trunkLineBonus: number;
  groupBonus: number;
  /** Penalty applied for each washout-requiring colour transition */
  colourWashoutPenalty: number;
  /** Bonus for clean (no washout) light-to-dark sequence */
  colourCleanBonus: number;
  /** Weight for utilisation sweet-spot factor (0–1) */
  utilisationWeight: number;
  /** Weight for workload balancing factor (0–1) */
  workloadWeight: number;
  /** Penalty for WOM/WOP availability issues */
  womPenalty: number;
}

/** Default weights used when schedule_rules don't specify overrides */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  trunkLineBonus: 10,
  groupBonus: 5,
  colourWashoutPenalty: 15,
  colourCleanBonus: 10,
  utilisationWeight: 1,
  workloadWeight: 1,
  womPenalty: 20,
};

/** All context needed by PlacementScorer for a single evaluation */
export interface ScoringContext {
  /** Other batches already assigned to the target resource on the target date */
  dailyBatches: ScoringBatch[];
  /** All batches across all resources on the target date (for workload balancing) */
  allDailyBatches: ScoringBatch[];
  /** Resource blocks that may overlap the target date */
  resourceBlocks: ScoringResourceBlock[];
  /** Colour transitions table */
  colourTransitions: ColourTransition[];
  /** Colour groups lookup */
  colourGroups: ColourGroup[];
  /** Substitution rules (if the batch is being moved to a non-primary resource) */
  substitutionRules: ScoringSubstitutionRule[];
  /**
   * Per-call weight overrides. Merged on top of the scorer's defaultWeights.
   * Omit or pass partial to let the scorer's rule-derived defaults take effect.
   */
  weights?: Partial<ScoringWeights>;
  /** Total number of active resources for workload balancing */
  activeResourceCount: number;
  /** Map from resourceId → trunk line identifier, used for trunk-line matching */
  resourceTrunkLines?: Record<string, string | null>;
}

/** Minimal batch data needed for scoring (avoids importing full Batch type) */
export interface ScoringBatch {
  id: string;
  batchVolume: number | null;
  sapColorGroup: string | null;
  /** Chemical base of the batch (e.g. "water", "solvent") for resource compatibility */
  chemicalBase: string | null;
  status: string;
  rmAvailable: boolean;
  packagingAvailable: boolean;
  /** ISO date when raw materials become available (e.g. "2025-03-15"). Used for date-based WOM checks. */
  rmAvailableDate?: string | null;
  /** ISO date when packaging becomes available (e.g. "2025-03-15"). Used for date-based WOP checks. */
  packagingAvailableDate?: string | null;
  planResourceId: string | null;
  planDate: string | null;
  bulkCode: string | null;
}

/** Minimal resource block for scoring */
export interface ScoringResourceBlock {
  resourceId: string;
  startDate: string;
  endDate: string;
}

/** Minimal substitution rule for scoring */
export interface ScoringSubstitutionRule {
  sourceResourceId: string | null;
  targetResourceId: string | null;
  conditions: {
    maxVolume?: number;
    minVolume?: number;
    colorGroups?: string[];
  } | null;
  enabled: boolean;
}

/** Minimal resource data needed for scoring */
export interface ScoringResource {
  id: string;
  minCapacity: number | null;
  maxCapacity: number | null;
  maxBatchesPerDay: number;
  chemicalBase: string | null;
  trunkLine: string | null;
  groupName: string | null;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Health Scoring types
// ---------------------------------------------------------------------------

/** Issue types detected during schedule health evaluation */
export type HealthIssueType =
  | "capacity_overload"
  | "colour_violation"
  | "wom"
  | "wop"
  | "under_utilization"
  | "unassigned"
  | "rule_violation";

/** Severity levels for health issues */
export type HealthIssueSeverity = "critical" | "warning" | "info";

/** A suggested corrective action for a health issue */
export interface SuggestedAction {
  /** Target resource ID for a reschedule suggestion */
  targetResourceId: string;
  /** Target date for a reschedule suggestion */
  targetDate: string;
  /** PlacementScore for this suggested move */
  placementScore: number;
  /** Human-readable description of the action */
  description: string;
}

/** A single issue detected in the schedule */
export interface HealthIssue {
  /** Unique type of the issue */
  type: HealthIssueType;
  /** Severity determines impact on overall health score */
  severity: HealthIssueSeverity;
  /** The batch affected by this issue */
  batchId: string;
  /** Resource involved (null for unassigned batches) */
  resourceId: string | null;
  /** Date of the issue (null for unassigned batches) */
  date: string | null;
  /** Human-readable explanation */
  message: string;
  /** Best corrective action found by PlacementScorer (null if no fix found) */
  suggestedAction: SuggestedAction | null;
}

/** Complete health report for a schedule snapshot */
export interface HealthReport {
  /** Overall health score: 100 minus weighted issue counts, clamped to [5, 100] */
  score: number;
  /** All detected issues, ordered by severity (critical first) */
  issues: HealthIssue[];
  /** Breakdown of issue counts by type */
  issueCounts: Record<HealthIssueType, number>;
  /** Timestamp of when this report was generated (ISO string) */
  generatedAt: string;
  /** Summary of the health evaluation */
  summary: string;
}

/** Weights for health score deductions per issue type */
export interface HealthScoringWeights {
  capacity_overload: number;
  colour_violation: number;
  wom: number;
  wop: number;
  under_utilization: number;
  unassigned: number;
  rule_violation: number;
}

/** Default health scoring weights (deduction per issue) */
export const DEFAULT_HEALTH_WEIGHTS: HealthScoringWeights = {
  capacity_overload: 10,
  colour_violation: 5,
  wom: 3,
  wop: 3,
  under_utilization: 2,
  unassigned: 8,
  rule_violation: 4,
};

/** All data needed by HealthScorer for evaluation */
export interface HealthScoringContext {
  /** All batches in the schedule snapshot */
  batches: ScoringBatch[];
  /** All resources available */
  resources: ScoringResource[];
  /** Resource blocks (maintenance, etc.) */
  resourceBlocks: ScoringResourceBlock[];
  /** Colour transition rules */
  colourTransitions: ColourTransition[];
  /** Colour group definitions */
  colourGroups: ColourGroup[];
  /** Substitution rules */
  substitutionRules: ScoringSubstitutionRule[];
  /** Map from resourceId → trunk line identifier */
  resourceTrunkLines?: Record<string, string | null>;
  /** Health weight overrides */
  healthWeights?: Partial<HealthScoringWeights>;
  /** Target date for the evaluation (ISO string, defaults to today) */
  evaluationDate?: string;
}
