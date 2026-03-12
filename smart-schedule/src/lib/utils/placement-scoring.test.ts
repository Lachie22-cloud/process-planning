import { beforeEach, describe, expect, it } from "vitest";
import {
  PlacementScorer,
  extractWeights,
  createScorer,
} from "./placement-scoring";
import type {
  ColourGroup,
  ColourTransition,
  ScoringBatch,
  ScoringContext,
  ScoringResource,
  ScoringResourceBlock,
  ScoringSubstitutionRule,
} from "@/types/scoring";
import { DEFAULT_SCORING_WEIGHTS } from "@/types/scoring";
import type { ScheduleRule } from "@/types/rule";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

let idCounter = 0;

function makeBatch(overrides: Partial<ScoringBatch> = {}): ScoringBatch {
  idCounter++;
  return {
    id: `batch-${idCounter.toString().padStart(3, "0")}`,
    batchVolume: 400,
    sapColorGroup: "WHITE",
    chemicalBase: "water",
    status: "Planned",
    rmAvailable: true,
    packagingAvailable: true,
    planResourceId: "resource-001",
    planDate: "2025-03-10",
    bulkCode: "BULK-001",
    ...overrides,
  };
}

function makeResource(
  overrides: Partial<ScoringResource> = {},
): ScoringResource {
  return {
    id: "resource-001",
    minCapacity: 100,
    maxCapacity: 500,
    maxBatchesPerDay: 4,
    chemicalBase: "water",
    trunkLine: "TL-A",
    groupName: "Group A",
    active: true,
    ...overrides,
  };
}

function makeColourGroups(): ColourGroup[] {
  return [
    { id: "cg-1", code: "CLEAR", name: "CLEAR", sortOrder: 0 },
    { id: "cg-2", code: "WHITE", name: "WHITE", sortOrder: 1 },
    { id: "cg-3", code: "WARM", name: "WARM", sortOrder: 2 },
    { id: "cg-4", code: "YELLOW", name: "YELLOW", sortOrder: 3 },
    { id: "cg-5", code: "RED", name: "RED", sortOrder: 4 },
    { id: "cg-6", code: "GREEN", name: "GREEN", sortOrder: 5 },
    { id: "cg-7", code: "BLUE", name: "BLUE", sortOrder: 6 },
    { id: "cg-8", code: "BLACK", name: "BLACK", sortOrder: 7 },
    { id: "cg-9", code: "OTHER", name: "OTHER", sortOrder: 8 },
  ];
}

function makeTransitions(): ColourTransition[] {
  const groups = makeColourGroups();
  const transitions: ColourTransition[] = [];
  for (const from of groups) {
    for (const to of groups) {
      if (from.id === to.id) {
        transitions.push({
          fromGroupId: from.id,
          toGroupId: to.id,
          allowed: true,
          requiresWashout: false,
          washoutMinutes: 0,
        });
      } else if (to.sortOrder < from.sortOrder) {
        // Dark to light requires washout
        transitions.push({
          fromGroupId: from.id,
          toGroupId: to.id,
          allowed: true,
          requiresWashout: true,
          washoutMinutes: 30,
        });
      } else {
        // Light to dark, no washout
        transitions.push({
          fromGroupId: from.id,
          toGroupId: to.id,
          allowed: true,
          requiresWashout: false,
          washoutMinutes: 0,
        });
      }
    }
  }
  return transitions;
}

function makeContext(
  overrides: Partial<ScoringContext> = {},
): ScoringContext {
  return {
    dailyBatches: [],
    allDailyBatches: [],
    resourceBlocks: [],
    colourTransitions: makeTransitions(),
    colourGroups: makeColourGroups(),
    substitutionRules: [],
    weights: { ...DEFAULT_SCORING_WEIGHTS },
    activeResourceCount: 3,
    ...overrides,
  };
}

function makeRule(overrides: Partial<ScheduleRule> = {}): ScheduleRule {
  return {
    id: "rule-001",
    siteId: "site-001",
    name: "Test rule",
    description: null,
    ruleType: "schedule",
    conditions: null,
    actions: null,
    ruleVersion: 1,
    schemaId: "schedule-rule/v1",
    enabled: true,
    createdBy: null,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

// Reset counter between describes
beforeEach(() => {
  idCounter = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PlacementScorer", () => {
  let scorer: PlacementScorer;

  beforeEach(() => {
    scorer = new PlacementScorer();
  });

  // -----------------------------------------------------------------------
  // Hard constraints
  // -----------------------------------------------------------------------
  describe("hard constraints", () => {
    it("returns score 0 for inactive resource", () => {
      const batch = makeBatch();
      const resource = makeResource({ active: false });
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      expect(result.score).toBe(0);
      expect(result.feasible).toBe(false);
      expect(result.violations).toContain("resource_inactive");
    });

    it("returns score 0 when batch volume is under resource min capacity", () => {
      const batch = makeBatch({ batchVolume: 50 });
      const resource = makeResource({ minCapacity: 100 });
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      expect(result.score).toBe(0);
      expect(result.feasible).toBe(false);
      expect(result.violations).toContain("under_capacity");
    });

    it("returns score 0 when batch volume exceeds resource max capacity", () => {
      const batch = makeBatch({ batchVolume: 600 });
      const resource = makeResource({ maxCapacity: 500 });
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      expect(result.score).toBe(0);
      expect(result.feasible).toBe(false);
      expect(result.violations).toContain("over_capacity");
    });

    it("passes capacity check when batch volume is null", () => {
      const batch = makeBatch({ batchVolume: null });
      const resource = makeResource({ minCapacity: 100, maxCapacity: 500 });
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      expect(result.feasible).toBe(true);
      expect(result.violations).not.toContain("under_capacity");
      expect(result.violations).not.toContain("over_capacity");
    });

    it("passes capacity check when volume equals min capacity exactly", () => {
      const batch = makeBatch({ batchVolume: 100 });
      const resource = makeResource({ minCapacity: 100, maxCapacity: 500 });
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      expect(result.feasible).toBe(true);
    });

    it("passes capacity check when volume equals max capacity exactly", () => {
      const batch = makeBatch({ batchVolume: 500 });
      const resource = makeResource({ minCapacity: 100, maxCapacity: 500 });
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      expect(result.feasible).toBe(true);
    });

    it("returns score 0 when resource is blocked on target date", () => {
      const batch = makeBatch();
      const resource = makeResource({ id: "res-blocked" });
      const blocks: ScoringResourceBlock[] = [
        {
          resourceId: "res-blocked",
          startDate: "2025-03-09",
          endDate: "2025-03-11",
        },
      ];
      const ctx = makeContext({ resourceBlocks: blocks });

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      expect(result.score).toBe(0);
      expect(result.feasible).toBe(false);
      expect(result.violations).toContain("resource_blocked");
    });

    it("passes resource block check when block is outside target date", () => {
      const batch = makeBatch();
      const resource = makeResource({ id: "res-blocked" });
      const blocks: ScoringResourceBlock[] = [
        {
          resourceId: "res-blocked",
          startDate: "2025-03-01",
          endDate: "2025-03-05",
        },
      ];
      const ctx = makeContext({ resourceBlocks: blocks });

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      expect(result.feasible).toBe(true);
    });

    it("passes resource block check when block is for a different resource", () => {
      const batch = makeBatch();
      const resource = makeResource({ id: "res-ok" });
      const blocks: ScoringResourceBlock[] = [
        {
          resourceId: "res-other",
          startDate: "2025-03-09",
          endDate: "2025-03-11",
        },
      ];
      const ctx = makeContext({ resourceBlocks: blocks });

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      expect(result.feasible).toBe(true);
    });

    it("returns score 0 when max batches per day is exceeded", () => {
      const batch = makeBatch();
      const resource = makeResource({ maxBatchesPerDay: 2 });
      const dailyBatches = [makeBatch(), makeBatch()]; // Already 2
      const ctx = makeContext({ dailyBatches });

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      expect(result.score).toBe(0);
      expect(result.feasible).toBe(false);
      expect(result.violations).toContain("max_batches_exceeded");
    });

    it("passes max batches check when under limit", () => {
      const batch = makeBatch();
      const resource = makeResource({ maxBatchesPerDay: 4 });
      const dailyBatches = [makeBatch(), makeBatch()]; // 2 of 4
      const ctx = makeContext({ dailyBatches });

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      expect(result.feasible).toBe(true);
    });

    it("returns score 0 when chemical base mismatches", () => {
      const batch = makeBatch({ chemicalBase: "solvent" });
      const resource = makeResource({ chemicalBase: "water" });
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      expect(result.score).toBe(0);
      expect(result.feasible).toBe(false);
      expect(result.violations).toContain("incompatible_base");
    });

    it("passes chemical base check when bases match", () => {
      const batch = makeBatch({ chemicalBase: "water" });
      const resource = makeResource({ chemicalBase: "water" });
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      expect(result.feasible).toBe(true);
      expect(result.violations).not.toContain("incompatible_base");
    });

    it("passes chemical base check when batch base is null", () => {
      const batch = makeBatch({ chemicalBase: null });
      const resource = makeResource({ chemicalBase: "water" });
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      expect(result.feasible).toBe(true);
      expect(result.violations).not.toContain("incompatible_base");
    });

    it("passes chemical base check when resource base is null", () => {
      const batch = makeBatch({ chemicalBase: "solvent" });
      const resource = makeResource({ chemicalBase: null });
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      expect(result.feasible).toBe(true);
      expect(result.violations).not.toContain("incompatible_base");
    });

    it("collects multiple violations when multiple hard constraints fail", () => {
      const batch = makeBatch({ batchVolume: 50 });
      const resource = makeResource({
        active: false,
        minCapacity: 100,
      });
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      expect(result.score).toBe(0);
      expect(result.feasible).toBe(false);
      expect(result.violations).toContain("resource_inactive");
      expect(result.violations).toContain("under_capacity");
      expect(result.violations.length).toBeGreaterThanOrEqual(2);
    });

  });

  // -----------------------------------------------------------------------
  // Soft factors – colour transitions
  // -----------------------------------------------------------------------
  describe("colour transition scoring", () => {
    it("gives clean start bonus when no prior batches on resource", () => {
      const batch = makeBatch({ sapColorGroup: "WHITE" });
      const resource = makeResource();
      const ctx = makeContext({ dailyBatches: [] });

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const colourFactor = result.factors.find(
        (f) => f.factor === "colour_transition",
      );
      expect(colourFactor).toBeDefined();
      expect(colourFactor!.raw).toBe(100);
      expect(colourFactor!.weighted).toBe(DEFAULT_SCORING_WEIGHTS.colourCleanBonus);
    });

    it("gives bonus for light-to-dark transition", () => {
      const prevBatch = makeBatch({ sapColorGroup: "WHITE" });
      const batch = makeBatch({ sapColorGroup: "BLACK" });
      const resource = makeResource();
      const ctx = makeContext({ dailyBatches: [prevBatch] });

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const colourFactor = result.factors.find(
        (f) => f.factor === "colour_transition",
      );
      expect(colourFactor!.raw).toBe(100);
      expect(colourFactor!.weighted).toBe(DEFAULT_SCORING_WEIGHTS.colourCleanBonus);
    });

    it("penalises dark-to-light transition with washout", () => {
      const prevBatch = makeBatch({ sapColorGroup: "BLACK" });
      const batch = makeBatch({ sapColorGroup: "WHITE" });
      const resource = makeResource();
      const ctx = makeContext({ dailyBatches: [prevBatch] });

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const colourFactor = result.factors.find(
        (f) => f.factor === "colour_transition",
      );
      expect(colourFactor!.raw).toBe(0);
      expect(colourFactor!.weighted).toBe(
        -DEFAULT_SCORING_WEIGHTS.colourWashoutPenalty,
      );
    });

    it("uses last batch in daily sequence for transition", () => {
      const batch1 = makeBatch({ sapColorGroup: "WHITE" });
      const batch2 = makeBatch({ sapColorGroup: "YELLOW" });
      const batch = makeBatch({ sapColorGroup: "RED" });
      const resource = makeResource();
      const ctx = makeContext({ dailyBatches: [batch1, batch2] });

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const colourFactor = result.factors.find(
        (f) => f.factor === "colour_transition",
      );
      // YELLOW→RED is light to dark, should get bonus
      expect(colourFactor!.raw).toBe(100);
    });

    it("gives neutral score when batch has no colour group", () => {
      const batch = makeBatch({ sapColorGroup: null });
      const resource = makeResource();
      const prevBatch = makeBatch({ sapColorGroup: "WHITE" });
      const ctx = makeContext({ dailyBatches: [prevBatch] });

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const colourFactor = result.factors.find(
        (f) => f.factor === "colour_transition",
      );
      // No colour group on new batch → clean start
      expect(colourFactor!.raw).toBe(100);
    });

    it("gives neutral score when previous batch has no colour group", () => {
      const prevBatch = makeBatch({ sapColorGroup: null });
      const batch = makeBatch({ sapColorGroup: "RED" });
      const resource = makeResource();
      const ctx = makeContext({ dailyBatches: [prevBatch] });

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const colourFactor = result.factors.find(
        (f) => f.factor === "colour_transition",
      );
      expect(colourFactor!.raw).toBe(50);
    });

    it("handles disallowed transition", () => {
      const groups = makeColourGroups();
      const transitions: ColourTransition[] = [
        {
          fromGroupId: groups[4]!.id, // RED
          toGroupId: groups[1]!.id, // WHITE
          allowed: false,
          requiresWashout: false,
          washoutMinutes: 0,
        },
      ];
      const prevBatch = makeBatch({ sapColorGroup: "RED" });
      const batch = makeBatch({ sapColorGroup: "WHITE" });
      const resource = makeResource();
      const ctx = makeContext({
        dailyBatches: [prevBatch],
        colourTransitions: transitions,
        colourGroups: groups,
      });

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const colourFactor = result.factors.find(
        (f) => f.factor === "colour_transition",
      );
      expect(colourFactor!.weighted).toBe(
        -DEFAULT_SCORING_WEIGHTS.colourWashoutPenalty,
      );
      expect(colourFactor!.reason).toContain("not allowed");
    });
  });

  // -----------------------------------------------------------------------
  // Soft factors – utilisation
  // -----------------------------------------------------------------------
  describe("utilisation scoring", () => {
    it("gives max score for sweet-spot utilisation (70-90%)", () => {
      const batch = makeBatch({ batchVolume: 400 }); // 80% of 500
      const resource = makeResource({ maxCapacity: 500 });
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const utilFactor = result.factors.find((f) => f.factor === "utilisation");
      expect(utilFactor!.raw).toBe(100);
    });

    it("gives high score for near-max utilisation (>90%)", () => {
      const batch = makeBatch({ batchVolume: 480 }); // 96% of 500
      const resource = makeResource({ maxCapacity: 500 });
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const utilFactor = result.factors.find((f) => f.factor === "utilisation");
      expect(utilFactor!.raw).toBe(80);
    });

    it("gives moderate score for 50-70% utilisation", () => {
      const batch = makeBatch({ batchVolume: 300 }); // 60% of 500
      const resource = makeResource({ maxCapacity: 500 });
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const utilFactor = result.factors.find((f) => f.factor === "utilisation");
      expect(utilFactor!.raw).toBe(60);
    });

    it("gives low score for under-utilised (<50%)", () => {
      const batch = makeBatch({ batchVolume: 150 }); // 30% of 500
      const resource = makeResource({ maxCapacity: 500 });
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const utilFactor = result.factors.find((f) => f.factor === "utilisation");
      expect(utilFactor!.raw).toBe(30);
    });

    it("gives neutral score when batch volume is null", () => {
      const batch = makeBatch({ batchVolume: null });
      const resource = makeResource({ maxCapacity: 500 });
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const utilFactor = result.factors.find((f) => f.factor === "utilisation");
      expect(utilFactor!.raw).toBe(50);
    });

    it("gives neutral score when maxCapacity is null", () => {
      const batch = makeBatch({ batchVolume: 400 });
      const resource = makeResource({ maxCapacity: null });
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const utilFactor = result.factors.find((f) => f.factor === "utilisation");
      expect(utilFactor!.raw).toBe(50);
    });
  });

  // -----------------------------------------------------------------------
  // Soft factors – trunk line & group matching
  // -----------------------------------------------------------------------
  describe("trunk line and group matching", () => {
    it("gives trunk line bonus when source and target trunk lines match", () => {
      const batch = makeBatch({ planResourceId: "resource-source" });
      const resource = makeResource({ trunkLine: "TL-A" });
      const ctx = makeContext({
        resourceTrunkLines: { "resource-source": "TL-A" },
      });

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const tlFactor = result.factors.find(
        (f) => f.factor === "trunk_line_match",
      );
      expect(tlFactor!.weighted).toBe(DEFAULT_SCORING_WEIGHTS.trunkLineBonus);
    });

    it("gives zero trunk line score when resource has no trunk line", () => {
      const batch = makeBatch();
      const resource = makeResource({ trunkLine: null });
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const tlFactor = result.factors.find(
        (f) => f.factor === "trunk_line_match",
      );
      expect(tlFactor!.weighted).toBe(0);
    });

    it("gives group bonus when resource has group name", () => {
      const batch = makeBatch();
      const resource = makeResource({ groupName: "Group A" });
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const groupFactor = result.factors.find(
        (f) => f.factor === "group_match",
      );
      expect(groupFactor!.weighted).toBe(DEFAULT_SCORING_WEIGHTS.groupBonus);
    });

    it("gives zero group score when resource has no group", () => {
      const batch = makeBatch();
      const resource = makeResource({ groupName: null });
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const groupFactor = result.factors.find(
        (f) => f.factor === "group_match",
      );
      expect(groupFactor!.weighted).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Soft factors – workload balance
  // -----------------------------------------------------------------------
  describe("workload balancing", () => {
    it("gives high score for under-loaded resource", () => {
      const batch = makeBatch();
      const resource = makeResource();
      const ctx = makeContext({
        dailyBatches: [], // 0 on this resource
        allDailyBatches: [
          makeBatch(),
          makeBatch(),
          makeBatch(),
          makeBatch(),
          makeBatch(),
          makeBatch(),
        ], // 6 total across 3 resources
        activeResourceCount: 3, // avg = 2
      });

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const wlFactor = result.factors.find(
        (f) => f.factor === "workload_balance",
      );
      // 0/2 ratio = 0, which is <= 0.5 → raw 100
      expect(wlFactor!.raw).toBe(100);
    });

    it("gives moderate score for average-loaded resource", () => {
      const batch = makeBatch();
      const resource = makeResource();
      const dailyOnResource = [makeBatch(), makeBatch()];
      const ctx = makeContext({
        dailyBatches: dailyOnResource,
        allDailyBatches: [
          makeBatch(),
          makeBatch(),
          makeBatch(),
          makeBatch(),
          makeBatch(),
          makeBatch(),
        ],
        activeResourceCount: 3, // avg = 2, current = 2, ratio = 1.0
      });

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const wlFactor = result.factors.find(
        (f) => f.factor === "workload_balance",
      );
      expect(wlFactor!.raw).toBe(70);
    });

    it("gives low score for overloaded resource", () => {
      const batch = makeBatch();
      const resource = makeResource({ maxBatchesPerDay: 10 });
      const dailyOnResource = [
        makeBatch(),
        makeBatch(),
        makeBatch(),
        makeBatch(),
      ];
      const ctx = makeContext({
        dailyBatches: dailyOnResource,
        allDailyBatches: [
          makeBatch(),
          makeBatch(),
          makeBatch(),
          makeBatch(),
          makeBatch(),
          makeBatch(),
        ],
        activeResourceCount: 3, // avg = 2, current = 4, ratio = 2.0
      });

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const wlFactor = result.factors.find(
        (f) => f.factor === "workload_balance",
      );
      expect(wlFactor!.raw).toBe(10);
    });

    it("gives neutral score for single resource system", () => {
      const batch = makeBatch();
      const resource = makeResource();
      const ctx = makeContext({
        activeResourceCount: 1,
      });

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const wlFactor = result.factors.find(
        (f) => f.factor === "workload_balance",
      );
      expect(wlFactor!.raw).toBe(50);
    });
  });

  // -----------------------------------------------------------------------
  // Soft factors – WOM/WOP
  // -----------------------------------------------------------------------
  describe("WOM/WOP scoring", () => {
    it("gives no penalty when materials and packaging available", () => {
      const batch = makeBatch({
        rmAvailable: true,
        packagingAvailable: true,
      });
      const resource = makeResource();
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const womFactor = result.factors.find((f) => f.factor === "wom_check");
      expect(womFactor!.weighted).toBe(0);
    });

    it("penalises when raw materials unavailable (WOM)", () => {
      const batch = makeBatch({
        rmAvailable: false,
        packagingAvailable: true,
      });
      const resource = makeResource();
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const womFactor = result.factors.find((f) => f.factor === "wom_check");
      expect(womFactor!.weighted).toBe(-DEFAULT_SCORING_WEIGHTS.womPenalty);
      expect(womFactor!.reason).toContain("WOM");
    });

    it("penalises when packaging unavailable (WOP)", () => {
      const batch = makeBatch({
        rmAvailable: true,
        packagingAvailable: false,
      });
      const resource = makeResource();
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const womFactor = result.factors.find((f) => f.factor === "wom_check");
      expect(womFactor!.weighted).toBe(-DEFAULT_SCORING_WEIGHTS.womPenalty);
      expect(womFactor!.reason).toContain("WOP");
    });

    it("double penalises when both materials and packaging unavailable", () => {
      const batch = makeBatch({
        rmAvailable: false,
        packagingAvailable: false,
      });
      const resource = makeResource();
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const womFactor = result.factors.find((f) => f.factor === "wom_check");
      expect(womFactor!.weighted).toBe(-DEFAULT_SCORING_WEIGHTS.womPenalty * 2);
    });
  });

  // -----------------------------------------------------------------------
  // Soft factors – substitution
  // -----------------------------------------------------------------------
  describe("substitution scoring (soft factor)", () => {
    it("gives neutral score when batch stays on same resource", () => {
      const resource = makeResource({ id: "resource-001" });
      const batch = makeBatch({ planResourceId: "resource-001" });
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const subFactor = result.factors.find((f) => f.factor === "substitution");
      expect(subFactor).toBeDefined();
      expect(subFactor!.weighted).toBe(0);
      expect(result.feasible).toBe(true);
    });

    it("gives neutral score when batch has no prior resource", () => {
      const batch = makeBatch({ planResourceId: null });
      const resource = makeResource({ id: "resource-target" });
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const subFactor = result.factors.find((f) => f.factor === "substitution");
      expect(subFactor!.weighted).toBe(0);
      expect(result.feasible).toBe(true);
    });

    it("gives neutral score when no substitution rules defined", () => {
      const batch = makeBatch({ planResourceId: "resource-source" });
      const resource = makeResource({ id: "resource-target" });
      const ctx = makeContext({ substitutionRules: [] });

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const subFactor = result.factors.find((f) => f.factor === "substitution");
      expect(subFactor!.weighted).toBe(0);
      expect(result.feasible).toBe(true);
    });

    it("gives bonus when matching substitution rule exists", () => {
      const batch = makeBatch({ planResourceId: "resource-source" });
      const resource = makeResource({ id: "resource-target" });
      const subRules: ScoringSubstitutionRule[] = [
        {
          sourceResourceId: "resource-source",
          targetResourceId: "resource-target",
          conditions: null,
          enabled: true,
        },
      ];
      const ctx = makeContext({ substitutionRules: subRules });

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const subFactor = result.factors.find((f) => f.factor === "substitution");
      expect(subFactor!.weighted).toBeGreaterThan(0);
      expect(result.feasible).toBe(true);
    });

    it("gives penalty when no rule allows the substitution", () => {
      const batch = makeBatch({ planResourceId: "resource-source" });
      const resource = makeResource({ id: "resource-target" });
      const subRules: ScoringSubstitutionRule[] = [
        {
          sourceResourceId: "resource-other",
          targetResourceId: "resource-target",
          conditions: null,
          enabled: true,
        },
      ];
      const ctx = makeContext({ substitutionRules: subRules });

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const subFactor = result.factors.find((f) => f.factor === "substitution");
      expect(subFactor!.weighted).toBeLessThan(0);
      // Still feasible – substitution is a soft factor, not a hard block
      expect(result.feasible).toBe(true);
    });

    it("gives bonus with wildcard source rule", () => {
      const batch = makeBatch({ planResourceId: "resource-source" });
      const resource = makeResource({ id: "resource-target" });
      const subRules: ScoringSubstitutionRule[] = [
        {
          sourceResourceId: null,
          targetResourceId: "resource-target",
          conditions: null,
          enabled: true,
        },
      ];
      const ctx = makeContext({ substitutionRules: subRules });

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const subFactor = result.factors.find((f) => f.factor === "substitution");
      expect(subFactor!.weighted).toBeGreaterThan(0);
    });

    it("gives penalty when volume exceeds rule maxVolume", () => {
      const batch = makeBatch({
        planResourceId: "resource-source",
        batchVolume: 600,
      });
      const resource = makeResource({
        id: "resource-target",
        maxCapacity: 1000,
      });
      const subRules: ScoringSubstitutionRule[] = [
        {
          sourceResourceId: "resource-source",
          targetResourceId: "resource-target",
          conditions: { maxVolume: 500 },
          enabled: true,
        },
      ];
      const ctx = makeContext({ substitutionRules: subRules });

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const subFactor = result.factors.find((f) => f.factor === "substitution");
      expect(subFactor!.weighted).toBeLessThan(0);
      expect(result.feasible).toBe(true);
    });

    it("gives penalty when colour group not in rule's allowed list", () => {
      const batch = makeBatch({
        planResourceId: "resource-source",
        sapColorGroup: "RED",
      });
      const resource = makeResource({ id: "resource-target" });
      const subRules: ScoringSubstitutionRule[] = [
        {
          sourceResourceId: "resource-source",
          targetResourceId: "resource-target",
          conditions: { colorGroups: ["WHITE", "YELLOW"] },
          enabled: true,
        },
      ];
      const ctx = makeContext({ substitutionRules: subRules });

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const subFactor = result.factors.find((f) => f.factor === "substitution");
      expect(subFactor!.weighted).toBeLessThan(0);
      expect(result.feasible).toBe(true);
    });

    it("ignores disabled substitution rules (treats as no match)", () => {
      const batch = makeBatch({ planResourceId: "resource-source" });
      const resource = makeResource({ id: "resource-target" });
      const subRules: ScoringSubstitutionRule[] = [
        {
          sourceResourceId: "resource-source",
          targetResourceId: "resource-target",
          conditions: null,
          enabled: false,
        },
      ];
      const ctx = makeContext({ substitutionRules: subRules });

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      const subFactor = result.factors.find((f) => f.factor === "substitution");
      expect(subFactor!.weighted).toBeLessThan(0);
      expect(result.feasible).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Composite scoring
  // -----------------------------------------------------------------------
  describe("composite score", () => {
    it("produces higher score for better-fit placements", () => {
      const resource = makeResource({
        maxCapacity: 500,
        trunkLine: "TL-A",
        groupName: "Group A",
      });

      // Good fit: sweet spot utilisation, materials available
      const goodBatch = makeBatch({
        batchVolume: 400, // 80% utilisation
        rmAvailable: true,
        packagingAvailable: true,
        planResourceId: "resource-001", // same resource, no substitution
      });

      // Poor fit: low utilisation, materials unavailable
      const poorBatch = makeBatch({
        batchVolume: 120, // 24% utilisation
        rmAvailable: false,
        packagingAvailable: false,
        planResourceId: "resource-001",
      });

      const ctx = makeContext();

      const goodResult = scorer.score(goodBatch, resource, "2025-03-10", ctx);
      const poorResult = scorer.score(poorBatch, resource, "2025-03-10", ctx);

      expect(goodResult.feasible).toBe(true);
      expect(poorResult.feasible).toBe(true);
      expect(goodResult.score).toBeGreaterThan(poorResult.score);
    });

    it("is deterministic: same input always produces same output", () => {
      const batch = makeBatch();
      const resource = makeResource();
      const ctx = makeContext();

      const result1 = scorer.score(batch, resource, "2025-03-10", ctx);
      const result2 = scorer.score(batch, resource, "2025-03-10", ctx);

      expect(result1).toEqual(result2);
    });

    it("returns all 7 soft factors in breakdown", () => {
      const batch = makeBatch();
      const resource = makeResource();
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      expect(result.factors).toHaveLength(7);
      const factorNames = result.factors.map((f) => f.factor);
      expect(factorNames).toContain("colour_transition");
      expect(factorNames).toContain("utilisation");
      expect(factorNames).toContain("trunk_line_match");
      expect(factorNames).toContain("group_match");
      expect(factorNames).toContain("workload_balance");
      expect(factorNames).toContain("wom_check");
      expect(factorNames).toContain("substitution");
    });

    it("includes human-readable summary", () => {
      const batch = makeBatch();
      const resource = makeResource();
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      expect(result.summary).toContain("Score");
    });

    it("blocked placement has descriptive summary", () => {
      const batch = makeBatch({ batchVolume: 50 });
      const resource = makeResource({ minCapacity: 100 });
      const ctx = makeContext();

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      expect(result.summary).toContain("Blocked");
    });
  });

  // -----------------------------------------------------------------------
  // Score is non-negative
  // -----------------------------------------------------------------------
  describe("score bounds", () => {
    it("score is never negative even with maximum penalties", () => {
      const batch = makeBatch({
        rmAvailable: false,
        packagingAvailable: false,
        sapColorGroup: "WHITE",
        batchVolume: 120,
        planResourceId: "resource-001",
      });
      const prevBatch = makeBatch({ sapColorGroup: "BLACK" });
      const resource = makeResource({
        maxCapacity: 500,
        trunkLine: null,
        groupName: null,
      });
      const ctx = makeContext({
        dailyBatches: [prevBatch],
        allDailyBatches: [
          makeBatch(),
          makeBatch(),
          makeBatch(),
          makeBatch(),
        ],
        activeResourceCount: 1,
      });

      const result = scorer.score(batch, resource, "2025-03-10", ctx);

      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });
});

// ---------------------------------------------------------------------------
// extractWeights
// ---------------------------------------------------------------------------

describe("extractWeights", () => {
  it("returns defaults when no rules provided", () => {
    const weights = extractWeights([]);

    expect(weights).toEqual(DEFAULT_SCORING_WEIGHTS);
  });

  it("extracts trunk line bonus from schedule rules", () => {
    const rules: ScheduleRule[] = [
      makeRule({
        conditions: { preference: "same_trunk_line" },
        actions: { score_bonus: 15 },
        enabled: true,
      }),
    ];

    const weights = extractWeights(rules);

    expect(weights.trunkLineBonus).toBe(15);
  });

  it("extracts group bonus from schedule rules", () => {
    const rules: ScheduleRule[] = [
      makeRule({
        conditions: { preference: "same_group" },
        actions: { score_bonus: 8 },
        enabled: true,
      }),
    ];

    const weights = extractWeights(rules);

    expect(weights.groupBonus).toBe(8);
  });

  it("ignores disabled rules", () => {
    const rules: ScheduleRule[] = [
      makeRule({
        conditions: { preference: "same_trunk_line" },
        actions: { score_bonus: 25 },
        enabled: false,
      }),
    ];

    const weights = extractWeights(rules);

    expect(weights.trunkLineBonus).toBe(DEFAULT_SCORING_WEIGHTS.trunkLineBonus);
  });

  it("ignores rules without actions", () => {
    const rules: ScheduleRule[] = [
      makeRule({
        conditions: { preference: "same_trunk_line" },
        actions: null,
        enabled: true,
      }),
    ];

    const weights = extractWeights(rules);

    expect(weights.trunkLineBonus).toBe(DEFAULT_SCORING_WEIGHTS.trunkLineBonus);
  });

  it("ignores rules with non-numeric score_bonus", () => {
    const rules: ScheduleRule[] = [
      makeRule({
        conditions: { preference: "same_trunk_line" },
        actions: { score_bonus: "invalid" },
        enabled: true,
      }),
    ];

    const weights = extractWeights(rules);

    expect(weights.trunkLineBonus).toBe(DEFAULT_SCORING_WEIGHTS.trunkLineBonus);
  });

  it("extracts colourWashoutPenalty from schedule rules", () => {
    const rules: ScheduleRule[] = [
      makeRule({
        actions: { colourWashoutPenalty: 25 },
        enabled: true,
      }),
    ];

    const weights = extractWeights(rules);

    expect(weights.colourWashoutPenalty).toBe(25);
  });

  it("extracts colourCleanBonus from schedule rules", () => {
    const rules: ScheduleRule[] = [
      makeRule({
        actions: { colourCleanBonus: 12 },
        enabled: true,
      }),
    ];

    const weights = extractWeights(rules);

    expect(weights.colourCleanBonus).toBe(12);
  });

  it("extracts utilisationWeight from schedule rules", () => {
    const rules: ScheduleRule[] = [
      makeRule({
        actions: { utilisationWeight: 2.5 },
        enabled: true,
      }),
    ];

    const weights = extractWeights(rules);

    expect(weights.utilisationWeight).toBe(2.5);
  });

  it("extracts workloadWeight from schedule rules", () => {
    const rules: ScheduleRule[] = [
      makeRule({
        actions: { workloadWeight: 0.8 },
        enabled: true,
      }),
    ];

    const weights = extractWeights(rules);

    expect(weights.workloadWeight).toBe(0.8);
  });

  it("extracts womPenalty from schedule rules", () => {
    const rules: ScheduleRule[] = [
      makeRule({
        actions: { womPenalty: 30 },
        enabled: true,
      }),
    ];

    const weights = extractWeights(rules);

    expect(weights.womPenalty).toBe(30);
  });

  it("extracts all weights from a single rule with multiple actions", () => {
    const rules: ScheduleRule[] = [
      makeRule({
        conditions: { preference: "same_trunk_line" },
        actions: {
          score_bonus: 20,
          colourWashoutPenalty: 18,
          colourCleanBonus: 14,
          utilisationWeight: 1.5,
          workloadWeight: 0.7,
          womPenalty: 25,
        },
        enabled: true,
      }),
    ];

    const weights = extractWeights(rules);

    expect(weights.trunkLineBonus).toBe(20);
    expect(weights.colourWashoutPenalty).toBe(18);
    expect(weights.colourCleanBonus).toBe(14);
    expect(weights.utilisationWeight).toBe(1.5);
    expect(weights.workloadWeight).toBe(0.7);
    expect(weights.womPenalty).toBe(25);
  });

  it("ignores non-numeric weight overrides", () => {
    const rules: ScheduleRule[] = [
      makeRule({
        actions: {
          colourWashoutPenalty: "bad",
          utilisationWeight: null,
          womPenalty: true,
        },
        enabled: true,
      }),
    ];

    const weights = extractWeights(rules);

    expect(weights.colourWashoutPenalty).toBe(DEFAULT_SCORING_WEIGHTS.colourWashoutPenalty);
    expect(weights.utilisationWeight).toBe(DEFAULT_SCORING_WEIGHTS.utilisationWeight);
    expect(weights.womPenalty).toBe(DEFAULT_SCORING_WEIGHTS.womPenalty);
  });

  it("does not extract weight overrides from disabled rules", () => {
    const rules: ScheduleRule[] = [
      makeRule({
        actions: { colourWashoutPenalty: 99, womPenalty: 99 },
        enabled: false,
      }),
    ];

    const weights = extractWeights(rules);

    expect(weights.colourWashoutPenalty).toBe(DEFAULT_SCORING_WEIGHTS.colourWashoutPenalty);
    expect(weights.womPenalty).toBe(DEFAULT_SCORING_WEIGHTS.womPenalty);
  });
});

// ---------------------------------------------------------------------------
// createScorer
// ---------------------------------------------------------------------------

describe("createScorer", () => {
  it("creates a scorer with extracted weights", () => {
    const rules: ScheduleRule[] = [
      makeRule({
        conditions: { preference: "same_trunk_line" },
        actions: { score_bonus: 20 },
        enabled: true,
      }),
    ];

    const scorer = createScorer(rules);

    expect(scorer).toBeInstanceOf(PlacementScorer);
    expect(scorer.defaultWeights.trunkLineBonus).toBe(20);
  });

  it("creates a scorer with defaults when no rules provided", () => {
    const scorer = createScorer([]);

    expect(scorer.defaultWeights).toEqual(DEFAULT_SCORING_WEIGHTS);
  });
});

// ---------------------------------------------------------------------------
// Reviewer fix #1: schedule-rule extracted weights affect scoring output
// ---------------------------------------------------------------------------

describe("effective weights from createScorer", () => {
  it("scorer defaultWeights from rules affect soft-factor contributions when ctx.weights is omitted", () => {
    // Create a scorer with a very high trunkLineBonus via schedule rules
    const rules: ScheduleRule[] = [
      makeRule({
        conditions: { preference: "same_trunk_line" },
        actions: { score_bonus: 50 }, // 50 instead of default 10
        enabled: true,
      }),
    ];
    const scorer = createScorer(rules);
    expect(scorer.defaultWeights.trunkLineBonus).toBe(50);

    const batch = makeBatch({ planResourceId: "resource-source" });
    const resource = makeResource({ trunkLine: "TL-A" });

    // ctx has NO weights override → scorer.defaultWeights should be used
    const ctx = makeContext({
      resourceTrunkLines: { "resource-source": "TL-A" },
    });
    delete ctx.weights; // Ensure weights is undefined

    const result = scorer.score(batch, resource, "2025-03-10", ctx);

    const tlFactor = result.factors.find(
      (f) => f.factor === "trunk_line_match",
    );
    // Should use the rule-derived bonus (50), not the default (10)
    expect(tlFactor!.weighted).toBe(50);
  });

  it("ctx.weights overrides scorer defaults when provided", () => {
    // Scorer has high trunkLineBonus from rules
    const rules: ScheduleRule[] = [
      makeRule({
        conditions: { preference: "same_trunk_line" },
        actions: { score_bonus: 50 },
        enabled: true,
      }),
    ];
    const scorer = createScorer(rules);

    const batch = makeBatch({ planResourceId: "resource-source" });
    const resource = makeResource({ trunkLine: "TL-A" });

    // ctx explicitly overrides trunkLineBonus
    const ctx = makeContext({
      weights: { trunkLineBonus: 7 },
      resourceTrunkLines: { "resource-source": "TL-A" },
    });

    const result = scorer.score(batch, resource, "2025-03-10", ctx);

    const tlFactor = result.factors.find(
      (f) => f.factor === "trunk_line_match",
    );
    // ctx override wins: 7
    expect(tlFactor!.weighted).toBe(7);
  });

  it("rule-derived womPenalty affects WOM scoring when ctx.weights is omitted", () => {
    const rules: ScheduleRule[] = [
      makeRule({
        actions: { womPenalty: 50 }, // 50 instead of default 20
        enabled: true,
      }),
    ];
    const scorer = createScorer(rules);

    const batch = makeBatch({
      rmAvailable: false,
      packagingAvailable: true,
    });
    const resource = makeResource();

    const ctx = makeContext();
    delete ctx.weights;

    const result = scorer.score(batch, resource, "2025-03-10", ctx);

    const womFactor = result.factors.find((f) => f.factor === "wom_check");
    // Should use rule-derived penalty (50), not default (20)
    expect(womFactor!.weighted).toBe(-50);
  });

  it("rule-derived utilisationWeight scales utilisation factor", () => {
    const rules: ScheduleRule[] = [
      makeRule({
        actions: { utilisationWeight: 3 }, // 3 instead of default 1
        enabled: true,
      }),
    ];
    const scorer = createScorer(rules);

    const batch = makeBatch({ batchVolume: 400 }); // 80% of 500 → raw 100
    const resource = makeResource({ maxCapacity: 500 });

    const ctx = makeContext();
    delete ctx.weights;

    const result = scorer.score(batch, resource, "2025-03-10", ctx);

    const utilFactor = result.factors.find((f) => f.factor === "utilisation");
    // raw=100, weight=3 → weighted=300
    expect(utilFactor!.weighted).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// Reviewer fix #2: trunk-line mismatch does not receive match bonus
// ---------------------------------------------------------------------------

describe("trunk line real matching", () => {
  let scorer: PlacementScorer;

  beforeEach(() => {
    scorer = new PlacementScorer();
  });

  it("gives penalty when trunk lines mismatch", () => {
    const batch = makeBatch({ planResourceId: "resource-source" });
    const resource = makeResource({ trunkLine: "TL-B" });
    const ctx = makeContext({
      resourceTrunkLines: { "resource-source": "TL-A" },
    });

    const result = scorer.score(batch, resource, "2025-03-10", ctx);

    const tlFactor = result.factors.find(
      (f) => f.factor === "trunk_line_match",
    );
    expect(tlFactor!.weighted).toBeLessThan(0);
    expect(tlFactor!.reason).toContain("mismatch");
  });

  it("gives neutral (0) when source resource has no trunk line", () => {
    const batch = makeBatch({ planResourceId: "resource-source" });
    const resource = makeResource({ trunkLine: "TL-B" });
    const ctx = makeContext({
      resourceTrunkLines: { "resource-source": null },
    });

    const result = scorer.score(batch, resource, "2025-03-10", ctx);

    const tlFactor = result.factors.find(
      (f) => f.factor === "trunk_line_match",
    );
    expect(tlFactor!.weighted).toBe(0);
    expect(tlFactor!.reason).toContain("neutral");
  });

  it("gives neutral (0) when no resourceTrunkLines map provided", () => {
    const batch = makeBatch({ planResourceId: "resource-source" });
    const resource = makeResource({ trunkLine: "TL-A" });
    const ctx = makeContext(); // no resourceTrunkLines

    const result = scorer.score(batch, resource, "2025-03-10", ctx);

    const tlFactor = result.factors.find(
      (f) => f.factor === "trunk_line_match",
    );
    expect(tlFactor!.weighted).toBe(0);
  });

  it("gives bonus when trunk lines match", () => {
    const batch = makeBatch({ planResourceId: "resource-source" });
    const resource = makeResource({ trunkLine: "TL-A" });
    const ctx = makeContext({
      resourceTrunkLines: { "resource-source": "TL-A" },
    });

    const result = scorer.score(batch, resource, "2025-03-10", ctx);

    const tlFactor = result.factors.find(
      (f) => f.factor === "trunk_line_match",
    );
    expect(tlFactor!.weighted).toBe(DEFAULT_SCORING_WEIGHTS.trunkLineBonus);
  });
});

// ---------------------------------------------------------------------------
// Reviewer fix #3: WOM/WOP date-based penalty logic
// ---------------------------------------------------------------------------

describe("WOM/WOP date-based scoring", () => {
  let scorer: PlacementScorer;

  beforeEach(() => {
    scorer = new PlacementScorer();
  });

  it("penalises when rmAvailableDate is after target date", () => {
    const batch = makeBatch({
      rmAvailable: true, // boolean says OK, but date says not yet
      rmAvailableDate: "2025-03-15", // after target 2025-03-10
      packagingAvailable: true,
    });
    const resource = makeResource();
    const ctx = makeContext();

    const result = scorer.score(batch, resource, "2025-03-10", ctx);

    const womFactor = result.factors.find((f) => f.factor === "wom_check");
    expect(womFactor!.weighted).toBe(-DEFAULT_SCORING_WEIGHTS.womPenalty);
    expect(womFactor!.reason).toContain("2025-03-15");
    expect(womFactor!.reason).toContain("WOM");
  });

  it("penalises when packagingAvailableDate is after target date", () => {
    const batch = makeBatch({
      rmAvailable: true,
      packagingAvailable: true, // boolean says OK, but date says not yet
      packagingAvailableDate: "2025-03-20",
    });
    const resource = makeResource();
    const ctx = makeContext();

    const result = scorer.score(batch, resource, "2025-03-10", ctx);

    const womFactor = result.factors.find((f) => f.factor === "wom_check");
    expect(womFactor!.weighted).toBe(-DEFAULT_SCORING_WEIGHTS.womPenalty);
    expect(womFactor!.reason).toContain("2025-03-20");
    expect(womFactor!.reason).toContain("WOP");
  });

  it("double-penalises when both dates are after target date", () => {
    const batch = makeBatch({
      rmAvailable: true,
      rmAvailableDate: "2025-03-12",
      packagingAvailable: true,
      packagingAvailableDate: "2025-03-18",
    });
    const resource = makeResource();
    const ctx = makeContext();

    const result = scorer.score(batch, resource, "2025-03-10", ctx);

    const womFactor = result.factors.find((f) => f.factor === "wom_check");
    expect(womFactor!.weighted).toBe(-DEFAULT_SCORING_WEIGHTS.womPenalty * 2);
  });

  it("does NOT penalise when rmAvailableDate is on target date", () => {
    const batch = makeBatch({
      rmAvailable: true,
      rmAvailableDate: "2025-03-10", // same as target
      packagingAvailable: true,
    });
    const resource = makeResource();
    const ctx = makeContext();

    const result = scorer.score(batch, resource, "2025-03-10", ctx);

    const womFactor = result.factors.find((f) => f.factor === "wom_check");
    expect(womFactor!.weighted).toBe(0);
    expect(womFactor!.reason).toContain("available");
  });

  it("does NOT penalise when rmAvailableDate is before target date", () => {
    const batch = makeBatch({
      rmAvailable: true,
      rmAvailableDate: "2025-03-05", // before target
      packagingAvailable: true,
    });
    const resource = makeResource();
    const ctx = makeContext();

    const result = scorer.score(batch, resource, "2025-03-10", ctx);

    const womFactor = result.factors.find((f) => f.factor === "wom_check");
    expect(womFactor!.weighted).toBe(0);
  });

  it("does NOT penalise when packagingAvailableDate is on target date", () => {
    const batch = makeBatch({
      rmAvailable: true,
      packagingAvailable: true,
      packagingAvailableDate: "2025-03-10", // same as target
    });
    const resource = makeResource();
    const ctx = makeContext();

    const result = scorer.score(batch, resource, "2025-03-10", ctx);

    const womFactor = result.factors.find((f) => f.factor === "wom_check");
    expect(womFactor!.weighted).toBe(0);
  });

  it("falls back to boolean when dates not provided", () => {
    const batch = makeBatch({
      rmAvailable: false,
      packagingAvailable: true,
      // No date fields → fallback to boolean
    });
    const resource = makeResource();
    const ctx = makeContext();

    const result = scorer.score(batch, resource, "2025-03-10", ctx);

    const womFactor = result.factors.find((f) => f.factor === "wom_check");
    expect(womFactor!.weighted).toBe(-DEFAULT_SCORING_WEIGHTS.womPenalty);
    expect(womFactor!.reason).toContain("WOM");
  });

  it("date takes precedence over boolean (date ok, boolean false)", () => {
    const batch = makeBatch({
      rmAvailable: false, // boolean says no
      rmAvailableDate: "2025-03-05", // but date says available before target
      packagingAvailable: true,
    });
    const resource = makeResource();
    const ctx = makeContext();

    const result = scorer.score(batch, resource, "2025-03-10", ctx);

    const womFactor = result.factors.find((f) => f.factor === "wom_check");
    // Date takes precedence → no penalty
    expect(womFactor!.weighted).toBe(0);
  });
});
