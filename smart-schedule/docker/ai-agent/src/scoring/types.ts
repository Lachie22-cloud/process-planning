// ---------------------------------------------------------------------------
// Scoring types for deterministic placement and health evaluation
// Ported from smart-schedule/src/types/scoring.ts for server-side use.
// ---------------------------------------------------------------------------

/** Machine-readable reason codes for placement decisions */
export type HardViolation =
  | 'under_capacity'
  | 'over_capacity'
  | 'incompatible_base'
  | 'resource_blocked'
  | 'max_batches_exceeded'
  | 'resource_inactive';

/** Soft-factor identifiers used in score breakdowns */
export type SoftFactor =
  | 'colour_transition'
  | 'utilisation'
  | 'trunk_line_match'
  | 'group_match'
  | 'workload_balance'
  | 'wom_check'
  | 'substitution';

/** A single scored soft factor with weight, raw value, and weighted contribution */
export interface SoftFactorScore {
  factor: SoftFactor;
  raw: number;
  weight: number;
  weighted: number;
  reason: string;
}

/** Result of scoring a single placement */
export interface PlacementScore {
  score: number;
  feasible: boolean;
  violations: HardViolation[];
  factors: SoftFactorScore[];
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
  colourWashoutPenalty: number;
  colourCleanBonus: number;
  utilisationWeight: number;
  workloadWeight: number;
  womPenalty: number;
}

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
  dailyBatches: ScoringBatch[];
  allDailyBatches: ScoringBatch[];
  resourceBlocks: ScoringResourceBlock[];
  colourTransitions: ColourTransition[];
  colourGroups: ColourGroup[];
  substitutionRules: ScoringSubstitutionRule[];
  weights?: Partial<ScoringWeights>;
  activeResourceCount: number;
  resourceTrunkLines?: Record<string, string | null>;
}

/** Minimal batch data needed for scoring */
export interface ScoringBatch {
  id: string;
  batchVolume: number | null;
  sapColorGroup: string | null;
  chemicalBase: string | null;
  status: string;
  rmAvailable: boolean;
  packagingAvailable: boolean;
  rmAvailableDate?: string | null;
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

export type HealthIssueType =
  | 'capacity_overload'
  | 'colour_violation'
  | 'wom'
  | 'wop'
  | 'under_utilization'
  | 'unassigned'
  | 'rule_violation';

export type HealthIssueSeverity = 'critical' | 'warning' | 'info';

export interface SuggestedAction {
  targetResourceId: string;
  targetDate: string;
  placementScore: number;
  description: string;
}

export interface HealthIssue {
  type: HealthIssueType;
  severity: HealthIssueSeverity;
  batchId: string;
  resourceId: string | null;
  date: string | null;
  message: string;
  suggestedAction: SuggestedAction | null;
}

export interface HealthReport {
  score: number;
  issues: HealthIssue[];
  issueCounts: Record<HealthIssueType, number>;
  generatedAt: string;
  summary: string;
}

export interface HealthScoringWeights {
  capacity_overload: number;
  colour_violation: number;
  wom: number;
  wop: number;
  under_utilization: number;
  unassigned: number;
  rule_violation: number;
}

export const DEFAULT_HEALTH_WEIGHTS: HealthScoringWeights = {
  capacity_overload: 10,
  colour_violation: 5,
  wom: 3,
  wop: 3,
  under_utilization: 2,
  unassigned: 8,
  rule_violation: 4,
};

export interface HealthScoringContext {
  batches: ScoringBatch[];
  resources: ScoringResource[];
  resourceBlocks: ScoringResourceBlock[];
  colourTransitions: ColourTransition[];
  colourGroups: ColourGroup[];
  substitutionRules: ScoringSubstitutionRule[];
  resourceTrunkLines?: Record<string, string | null>;
  healthWeights?: Partial<HealthScoringWeights>;
  evaluationDate?: string;
}
