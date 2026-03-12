// ---------------------------------------------------------------------------
// HealthScorer tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { HealthScorer, createHealthScorer } from "./health-scoring";
import { PlacementScorer } from "./placement-scoring";
import type {
  ScoringBatch,
  ScoringResource,
  ColourGroup,
  ColourTransition,
  HealthScoringContext,
  HealthScoringWeights,
  HealthIssueType,
} from "@/types/scoring";
import { DEFAULT_SCORING_WEIGHTS, DEFAULT_HEALTH_WEIGHTS } from "@/types/scoring";

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makeBatch(overrides?: Partial<ScoringBatch>): ScoringBatch {
  return {
    id: "batch-1",
    batchVolume: 500,
    sapColorGroup: "WHITE",
    chemicalBase: "water",
    status: "scheduled",
    rmAvailable: true,
    packagingAvailable: true,
    rmAvailableDate: null,
    packagingAvailableDate: null,
    planResourceId: "res-1",
    planDate: "2025-03-15",
    bulkCode: "BULK-001",
    ...overrides,
  };
}

function makeResource(overrides?: Partial<ScoringResource>): ScoringResource {
  return {
    id: "res-1",
    minCapacity: 100,
    maxCapacity: 1000,
    maxBatchesPerDay: 5,
    chemicalBase: "water",
    trunkLine: "TL-A",
    groupName: "Group-1",
    active: true,
    ...overrides,
  };
}

function makeColourGroups(): ColourGroup[] {
  return [
    { id: "cg-clear", code: "CLEAR", name: "Clear", sortOrder: 1 },
    { id: "cg-white", code: "WHITE", name: "White", sortOrder: 2 },
    { id: "cg-yellow", code: "YELLOW", name: "Yellow", sortOrder: 3 },
    { id: "cg-red", code: "RED", name: "Red", sortOrder: 5 },
    { id: "cg-blue", code: "BLUE", name: "Blue", sortOrder: 6 },
    { id: "cg-black", code: "BLACK", name: "Black", sortOrder: 9 },
  ];
}

function makeTransitions(): ColourTransition[] {
  const groups = makeColourGroups();
  const transitions: ColourTransition[] = [];
  for (const from of groups) {
    for (const to of groups) {
      if (from.id === to.id) continue;
      const lightToDark = to.sortOrder >= from.sortOrder;
      transitions.push({
        fromGroupId: from.id,
        toGroupId: to.id,
        allowed: lightToDark, // dark-to-light not allowed
        requiresWashout: false,
        washoutMinutes: 0,
      });
    }
  }
  return transitions;
}

function makeContext(overrides?: Partial<HealthScoringContext>): HealthScoringContext {
  return {
    batches: [makeBatch()],
    resources: [makeResource()],
    resourceBlocks: [],
    colourTransitions: makeTransitions(),
    colourGroups: makeColourGroups(),
    substitutionRules: [],
    evaluationDate: "2025-03-15",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HealthScorer", () => {
  let scorer: HealthScorer;

  beforeEach(() => {
    const placementScorer = new PlacementScorer(DEFAULT_SCORING_WEIGHTS);
    scorer = new HealthScorer(placementScorer);
  });

  // -----------------------------------------------------------------------
  // Score formula
  // -----------------------------------------------------------------------

  describe("score formula", () => {
    it("returns 100 for a healthy schedule with no issues", () => {
      // Use maxBatchesPerDay=3 with 1 batch → 33% ≥ 30%, no under_utilization
      const ctx = makeContext({
        batches: [makeBatch()],
        resources: [makeResource({ maxBatchesPerDay: 3 })],
      });
      const report = scorer.evaluate(ctx);
      expect(report.score).toBe(100);
      expect(report.issues).toHaveLength(0);
    });

    it("deducts weighted issue counts from 100", () => {
      // 2 unassigned batches: 2 * 8 = 16 deduction → score = 84
      const ctx = makeContext({
        batches: [
          makeBatch({ id: "b1", planResourceId: null, planDate: null }),
          makeBatch({ id: "b2", planResourceId: null, planDate: null }),
        ],
        resources: [makeResource()],
      });
      const report = scorer.evaluate(ctx);
      expect(report.score).toBe(100 - 2 * DEFAULT_HEALTH_WEIGHTS.unassigned);
    });

    it("clamps score to minimum of 5", () => {
      // Many unassigned batches should push score down but never below 5
      const batches = Array.from({ length: 50 }, (_, i) =>
        makeBatch({ id: `b${i}`, planResourceId: null, planDate: null }),
      );
      const ctx = makeContext({ batches, resources: [makeResource()] });
      const report = scorer.evaluate(ctx);
      expect(report.score).toBe(5);
    });

    it("clamps score to maximum of 100", () => {
      const ctx = makeContext({
        batches: [],
        resources: [makeResource()],
      });
      const report = scorer.evaluate(ctx);
      expect(report.score).toBe(100);
    });

    it("uses custom health weights when provided", () => {
      const customWeights: HealthScoringWeights = {
        ...DEFAULT_HEALTH_WEIGHTS,
        unassigned: 50,
      };
      const ctx = makeContext({
        batches: [makeBatch({ id: "b1", planResourceId: null, planDate: null })],
        resources: [makeResource()],
        healthWeights: customWeights,
      });
      const report = scorer.evaluate(ctx);
      expect(report.score).toBe(50); // 100 - 50
    });

    it("computeScore is deterministic with same inputs", () => {
      const counts: Record<HealthIssueType, number> = {
        capacity_overload: 1,
        colour_violation: 2,
        wom: 0,
        wop: 1,
        under_utilization: 0,
        unassigned: 1,
        rule_violation: 0,
      };
      const score1 = scorer.computeScore(counts, DEFAULT_HEALTH_WEIGHTS);
      const score2 = scorer.computeScore(counts, DEFAULT_HEALTH_WEIGHTS);
      expect(score1).toBe(score2);
      // 100 - (10*1 + 5*2 + 3*1 + 8*1) = 100 - 31 = 69
      expect(score1).toBe(69);
    });
  });

  // -----------------------------------------------------------------------
  // Unassigned batches
  // -----------------------------------------------------------------------

  describe("unassigned batches", () => {
    it("detects batches with no resource assignment", () => {
      const ctx = makeContext({
        batches: [makeBatch({ id: "b1", planResourceId: null })],
        resources: [makeResource()],
      });
      const report = scorer.evaluate(ctx);
      expect(report.issues).toHaveLength(1);
      expect(report.issues[0]!.type).toBe("unassigned");
      expect(report.issues[0]!.severity).toBe("critical");
      expect(report.issues[0]!.batchId).toBe("b1");
    });

    it("detects batches with no date assignment", () => {
      const ctx = makeContext({
        batches: [makeBatch({ id: "b1", planDate: null })],
        resources: [makeResource()],
      });
      const report = scorer.evaluate(ctx);
      const unassigned = report.issues.filter((i) => i.type === "unassigned");
      expect(unassigned).toHaveLength(1);
    });

    it("provides a suggested action for unassigned batches", () => {
      const ctx = makeContext({
        batches: [makeBatch({ id: "b1", planResourceId: null, planDate: null })],
        resources: [makeResource()],
      });
      const report = scorer.evaluate(ctx);
      const issue = report.issues.find((i) => i.type === "unassigned");
      expect(issue).toBeDefined();
      expect(issue!.suggestedAction).not.toBeNull();
      expect(issue!.suggestedAction!.targetResourceId).toBe("res-1");
    });

    it("returns null suggested action when no feasible resources exist", () => {
      const ctx = makeContext({
        batches: [makeBatch({ id: "b1", planResourceId: null, planDate: null })],
        resources: [makeResource({ active: false })],
      });
      const report = scorer.evaluate(ctx);
      const issue = report.issues.find((i) => i.type === "unassigned");
      expect(issue!.suggestedAction).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Capacity overload
  // -----------------------------------------------------------------------

  describe("capacity overload", () => {
    it("detects when resource exceeds maxBatchesPerDay", () => {
      const resource = makeResource({ id: "res-1", maxBatchesPerDay: 2 });
      const batches = [
        makeBatch({ id: "b1", planResourceId: "res-1", planDate: "2025-03-15" }),
        makeBatch({ id: "b2", planResourceId: "res-1", planDate: "2025-03-15" }),
        makeBatch({ id: "b3", planResourceId: "res-1", planDate: "2025-03-15" }),
      ];
      const ctx = makeContext({ batches, resources: [resource] });
      const report = scorer.evaluate(ctx);
      const overloads = report.issues.filter((i) => i.type === "capacity_overload");
      expect(overloads.length).toBeGreaterThanOrEqual(1);
      expect(overloads[0]!.severity).toBe("critical");
    });

    it("detects when batch volume exceeds resource maxCapacity", () => {
      const resource = makeResource({ id: "res-1", maxCapacity: 500 });
      const batch = makeBatch({ id: "b1", batchVolume: 700, planResourceId: "res-1" });
      const ctx = makeContext({ batches: [batch], resources: [resource] });
      const report = scorer.evaluate(ctx);
      const overloads = report.issues.filter((i) => i.type === "capacity_overload");
      expect(overloads.length).toBeGreaterThanOrEqual(1);
    });

    it("suggests alternative resource for overloaded batches", () => {
      const res1 = makeResource({ id: "res-1", maxBatchesPerDay: 1 });
      const res2 = makeResource({ id: "res-2" });
      const batches = [
        makeBatch({ id: "b1", planResourceId: "res-1", planDate: "2025-03-15" }),
        makeBatch({ id: "b2", planResourceId: "res-1", planDate: "2025-03-15" }),
      ];
      const ctx = makeContext({ batches, resources: [res1, res2] });
      const report = scorer.evaluate(ctx);
      const overloads = report.issues.filter((i) => i.type === "capacity_overload");
      expect(overloads.length).toBeGreaterThanOrEqual(1);
      const suggestion = overloads[0]!.suggestedAction;
      expect(suggestion).not.toBeNull();
      expect(suggestion!.targetResourceId).toBe("res-2");
    });

    it("no capacity issue when batches are within limits", () => {
      const resource = makeResource({ id: "res-1", maxBatchesPerDay: 5 });
      const batches = [
        makeBatch({ id: "b1", planResourceId: "res-1", planDate: "2025-03-15" }),
        makeBatch({ id: "b2", planResourceId: "res-1", planDate: "2025-03-15" }),
      ];
      const ctx = makeContext({ batches, resources: [resource] });
      const report = scorer.evaluate(ctx);
      const overloads = report.issues.filter((i) => i.type === "capacity_overload");
      expect(overloads).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Colour violations
  // -----------------------------------------------------------------------

  describe("colour violations", () => {
    it("detects disallowed colour transitions", () => {
      // BLACK → WHITE is dark-to-light, not allowed by our makeTransitions()
      const batches = [
        makeBatch({ id: "b1", sapColorGroup: "BLACK", planResourceId: "res-1", planDate: "2025-03-15" }),
        makeBatch({ id: "b2", sapColorGroup: "WHITE", planResourceId: "res-1", planDate: "2025-03-15" }),
      ];
      const ctx = makeContext({ batches, resources: [makeResource()] });
      const report = scorer.evaluate(ctx);
      const colourIssues = report.issues.filter((i) => i.type === "colour_violation");
      expect(colourIssues).toHaveLength(1);
      expect(colourIssues[0]!.severity).toBe("warning");
      expect(colourIssues[0]!.batchId).toBe("b2");
    });

    it("no violation for light-to-dark transitions", () => {
      const batches = [
        makeBatch({ id: "b1", sapColorGroup: "WHITE", planResourceId: "res-1", planDate: "2025-03-15" }),
        makeBatch({ id: "b2", sapColorGroup: "BLACK", planResourceId: "res-1", planDate: "2025-03-15" }),
      ];
      const ctx = makeContext({ batches, resources: [makeResource()] });
      const report = scorer.evaluate(ctx);
      const colourIssues = report.issues.filter((i) => i.type === "colour_violation");
      expect(colourIssues).toHaveLength(0);
    });

    it("no violation when batch has no colour group", () => {
      const batches = [
        makeBatch({ id: "b1", sapColorGroup: null, planResourceId: "res-1", planDate: "2025-03-15" }),
        makeBatch({ id: "b2", sapColorGroup: "BLACK", planResourceId: "res-1", planDate: "2025-03-15" }),
      ];
      const ctx = makeContext({ batches, resources: [makeResource()] });
      const report = scorer.evaluate(ctx);
      const colourIssues = report.issues.filter((i) => i.type === "colour_violation");
      expect(colourIssues).toHaveLength(0);
    });

    it("suggests alternative placement for colour-violating batch", () => {
      const res1 = makeResource({ id: "res-1" });
      const res2 = makeResource({ id: "res-2" });
      const batches = [
        makeBatch({ id: "b1", sapColorGroup: "BLACK", planResourceId: "res-1", planDate: "2025-03-15" }),
        makeBatch({ id: "b2", sapColorGroup: "WHITE", planResourceId: "res-1", planDate: "2025-03-15" }),
      ];
      const ctx = makeContext({ batches, resources: [res1, res2] });
      const report = scorer.evaluate(ctx);
      const colourIssues = report.issues.filter((i) => i.type === "colour_violation");
      expect(colourIssues).toHaveLength(1);
      expect(colourIssues[0]!.suggestedAction).not.toBeNull();
    });

    it("detects multiple colour violations in sequence", () => {
      // BLACK → WHITE (violation), WHITE → CLEAR (violation - both dark-to-light)
      const batches = [
        makeBatch({ id: "b1", sapColorGroup: "RED", planResourceId: "res-1", planDate: "2025-03-15" }),
        makeBatch({ id: "b2", sapColorGroup: "WHITE", planResourceId: "res-1", planDate: "2025-03-15" }),
        makeBatch({ id: "b3", sapColorGroup: "CLEAR", planResourceId: "res-1", planDate: "2025-03-15" }),
      ];
      const ctx = makeContext({ batches, resources: [makeResource()] });
      const report = scorer.evaluate(ctx);
      const colourIssues = report.issues.filter((i) => i.type === "colour_violation");
      expect(colourIssues).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // WOM (raw materials) issues
  // -----------------------------------------------------------------------

  describe("WOM issues", () => {
    it("detects WOM issue when rmAvailable is false", () => {
      const batch = makeBatch({ id: "b1", rmAvailable: false, rmAvailableDate: null });
      const ctx = makeContext({ batches: [batch], resources: [makeResource()] });
      const report = scorer.evaluate(ctx);
      const womIssues = report.issues.filter((i) => i.type === "wom");
      expect(womIssues).toHaveLength(1);
      expect(womIssues[0]!.severity).toBe("warning");
    });

    it("detects WOM issue when rmAvailableDate is after plan date", () => {
      const batch = makeBatch({
        id: "b1",
        rmAvailableDate: "2025-03-20",
        planDate: "2025-03-15",
      });
      const ctx = makeContext({ batches: [batch], resources: [makeResource()] });
      const report = scorer.evaluate(ctx);
      const womIssues = report.issues.filter((i) => i.type === "wom");
      expect(womIssues).toHaveLength(1);
      expect(womIssues[0]!.message).toContain("2025-03-20");
    });

    it("no WOM issue when rmAvailableDate is on or before plan date", () => {
      const batch = makeBatch({
        id: "b1",
        rmAvailableDate: "2025-03-15",
        planDate: "2025-03-15",
      });
      const ctx = makeContext({ batches: [batch], resources: [makeResource()] });
      const report = scorer.evaluate(ctx);
      const womIssues = report.issues.filter((i) => i.type === "wom");
      expect(womIssues).toHaveLength(0);
    });

    it("date takes precedence over boolean for WOM", () => {
      // rmAvailable=false but rmAvailableDate is before plan date → no issue
      const batch = makeBatch({
        id: "b1",
        rmAvailable: false,
        rmAvailableDate: "2025-03-10",
        planDate: "2025-03-15",
      });
      const ctx = makeContext({ batches: [batch], resources: [makeResource()] });
      const report = scorer.evaluate(ctx);
      const womIssues = report.issues.filter((i) => i.type === "wom");
      expect(womIssues).toHaveLength(0);
    });

    it("suggests date shift for WOM issues with rmAvailableDate", () => {
      const batch = makeBatch({
        id: "b1",
        rmAvailableDate: "2025-03-20",
        planDate: "2025-03-15",
      });
      const ctx = makeContext({ batches: [batch], resources: [makeResource()] });
      const report = scorer.evaluate(ctx);
      const womIssues = report.issues.filter((i) => i.type === "wom");
      expect(womIssues).toHaveLength(1);
      const suggestion = womIssues[0]!.suggestedAction;
      expect(suggestion).not.toBeNull();
      expect(suggestion!.targetDate).toBe("2025-03-20");
    });
  });

  // -----------------------------------------------------------------------
  // WOP (packaging) issues
  // -----------------------------------------------------------------------

  describe("WOP issues", () => {
    it("detects WOP issue when packagingAvailable is false", () => {
      const batch = makeBatch({ id: "b1", packagingAvailable: false, packagingAvailableDate: null });
      const ctx = makeContext({ batches: [batch], resources: [makeResource()] });
      const report = scorer.evaluate(ctx);
      const wopIssues = report.issues.filter((i) => i.type === "wop");
      expect(wopIssues).toHaveLength(1);
      expect(wopIssues[0]!.severity).toBe("warning");
    });

    it("detects WOP issue when packagingAvailableDate is after plan date", () => {
      const batch = makeBatch({
        id: "b1",
        packagingAvailableDate: "2025-03-20",
        planDate: "2025-03-15",
      });
      const ctx = makeContext({ batches: [batch], resources: [makeResource()] });
      const report = scorer.evaluate(ctx);
      const wopIssues = report.issues.filter((i) => i.type === "wop");
      expect(wopIssues).toHaveLength(1);
    });

    it("no WOP issue when packagingAvailableDate is on or before plan date", () => {
      const batch = makeBatch({
        id: "b1",
        packagingAvailableDate: "2025-03-15",
        planDate: "2025-03-15",
      });
      const ctx = makeContext({ batches: [batch], resources: [makeResource()] });
      const report = scorer.evaluate(ctx);
      const wopIssues = report.issues.filter((i) => i.type === "wop");
      expect(wopIssues).toHaveLength(0);
    });

    it("date takes precedence over boolean for WOP", () => {
      const batch = makeBatch({
        id: "b1",
        packagingAvailable: false,
        packagingAvailableDate: "2025-03-10",
        planDate: "2025-03-15",
      });
      const ctx = makeContext({ batches: [batch], resources: [makeResource()] });
      const report = scorer.evaluate(ctx);
      const wopIssues = report.issues.filter((i) => i.type === "wop");
      expect(wopIssues).toHaveLength(0);
    });

    it("detects both WOM and WOP issues on the same batch", () => {
      const batch = makeBatch({
        id: "b1",
        rmAvailable: false,
        rmAvailableDate: null,
        packagingAvailable: false,
        packagingAvailableDate: null,
      });
      const ctx = makeContext({ batches: [batch], resources: [makeResource()] });
      const report = scorer.evaluate(ctx);
      const materialIssues = report.issues.filter(
        (i) => i.type === "wom" || i.type === "wop",
      );
      expect(materialIssues).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // WOM/WOP issue-specific date selection
  // -----------------------------------------------------------------------

  describe("WOM/WOP issue-specific date selection", () => {
    it("WOP suggestedAction uses packagingAvailableDate, not rmAvailableDate, when both exist", () => {
      // packagingAvailableDate (2025-03-25) is LATER than rmAvailableDate (2025-03-18)
      // The WOP issue's suggested date must target packaging date, not RM date
      const batch = makeBatch({
        id: "b1",
        rmAvailableDate: "2025-03-18",
        packagingAvailableDate: "2025-03-25",
        rmAvailable: true,
        packagingAvailable: true,
        planResourceId: "res-1",
        planDate: "2025-03-15",
      });
      const ctx = makeContext({ batches: [batch], resources: [makeResource()] });
      const report = scorer.evaluate(ctx);

      const wopIssues = report.issues.filter((i) => i.type === "wop");
      expect(wopIssues).toHaveLength(1);
      expect(wopIssues[0]!.suggestedAction).not.toBeNull();
      expect(wopIssues[0]!.suggestedAction!.targetDate).toBe("2025-03-25");
    });

    it("WOM suggestedAction uses rmAvailableDate when both dates exist", () => {
      // rmAvailableDate (2025-03-18) and packagingAvailableDate (2025-03-25)
      // The WOM issue's suggested date must target RM date, not packaging date
      const batch = makeBatch({
        id: "b1",
        rmAvailableDate: "2025-03-18",
        packagingAvailableDate: "2025-03-25",
        rmAvailable: true,
        packagingAvailable: true,
        planResourceId: "res-1",
        planDate: "2025-03-15",
      });
      const ctx = makeContext({ batches: [batch], resources: [makeResource()] });
      const report = scorer.evaluate(ctx);

      const womIssues = report.issues.filter((i) => i.type === "wom");
      expect(womIssues).toHaveLength(1);
      expect(womIssues[0]!.suggestedAction).not.toBeNull();
      expect(womIssues[0]!.suggestedAction!.targetDate).toBe("2025-03-18");
    });

    it("WOM and WOP suggested dates differ when both dates exist and packaging is later", () => {
      const batch = makeBatch({
        id: "b1",
        rmAvailableDate: "2025-03-20",
        packagingAvailableDate: "2025-03-28",
        rmAvailable: true,
        packagingAvailable: true,
        planResourceId: "res-1",
        planDate: "2025-03-15",
      });
      const ctx = makeContext({ batches: [batch], resources: [makeResource()] });
      const report = scorer.evaluate(ctx);

      const womIssue = report.issues.find((i) => i.type === "wom");
      const wopIssue = report.issues.find((i) => i.type === "wop");
      expect(womIssue).toBeDefined();
      expect(wopIssue).toBeDefined();
      expect(womIssue!.suggestedAction!.targetDate).toBe("2025-03-20");
      expect(wopIssue!.suggestedAction!.targetDate).toBe("2025-03-28");
      // They must differ because the dates are different
      expect(womIssue!.suggestedAction!.targetDate).not.toBe(
        wopIssue!.suggestedAction!.targetDate,
      );
    });

    it("WOP suggestedAction uses packagingAvailableDate even when rmAvailableDate is earlier", () => {
      // Reverse scenario: RM is later, packaging is earlier but still after plan date
      const batch = makeBatch({
        id: "b1",
        rmAvailableDate: "2025-03-28",
        packagingAvailableDate: "2025-03-20",
        rmAvailable: true,
        packagingAvailable: true,
        planResourceId: "res-1",
        planDate: "2025-03-15",
      });
      const ctx = makeContext({ batches: [batch], resources: [makeResource()] });
      const report = scorer.evaluate(ctx);

      const wopIssue = report.issues.find((i) => i.type === "wop");
      expect(wopIssue).toBeDefined();
      expect(wopIssue!.suggestedAction).not.toBeNull();
      // Must use packagingAvailableDate, NOT rmAvailableDate
      expect(wopIssue!.suggestedAction!.targetDate).toBe("2025-03-20");

      const womIssue = report.issues.find((i) => i.type === "wom");
      expect(womIssue).toBeDefined();
      expect(womIssue!.suggestedAction).not.toBeNull();
      // Must use rmAvailableDate
      expect(womIssue!.suggestedAction!.targetDate).toBe("2025-03-28");
    });
  });

  // -----------------------------------------------------------------------
  // Under-utilization
  // -----------------------------------------------------------------------

  describe("under-utilization", () => {
    it("detects under-utilized resources (<30% batch capacity)", () => {
      const resource = makeResource({ id: "res-1", maxBatchesPerDay: 10 });
      const batches = [
        makeBatch({ id: "b1", planResourceId: "res-1", planDate: "2025-03-15" }),
        makeBatch({ id: "b2", planResourceId: "res-1", planDate: "2025-03-15" }),
      ];
      const ctx = makeContext({ batches, resources: [resource] });
      const report = scorer.evaluate(ctx);
      const underUtil = report.issues.filter((i) => i.type === "under_utilization");
      expect(underUtil).toHaveLength(1);
      expect(underUtil[0]!.severity).toBe("info");
    });

    it("no under-utilization when load is adequate", () => {
      const resource = makeResource({ id: "res-1", maxBatchesPerDay: 5 });
      const batches = [
        makeBatch({ id: "b1", planResourceId: "res-1", planDate: "2025-03-15" }),
        makeBatch({ id: "b2", planResourceId: "res-1", planDate: "2025-03-15" }),
      ];
      const ctx = makeContext({ batches, resources: [resource] });
      const report = scorer.evaluate(ctx);
      const underUtil = report.issues.filter((i) => i.type === "under_utilization");
      expect(underUtil).toHaveLength(0);
    });

    it("no under-utilization for inactive resources", () => {
      const resource = makeResource({ id: "res-1", maxBatchesPerDay: 10, active: false });
      const batches = [
        makeBatch({ id: "b1", planResourceId: "res-1", planDate: "2025-03-15" }),
      ];
      const ctx = makeContext({ batches, resources: [resource] });
      const report = scorer.evaluate(ctx);
      const underUtil = report.issues.filter((i) => i.type === "under_utilization");
      expect(underUtil).toHaveLength(0);
    });

    it("suggests consolidation to another resource via PlacementScorer", () => {
      // res-1 is under-utilized (1/10 = 10%), res-2 is a feasible alternative
      const res1 = makeResource({ id: "res-1", maxBatchesPerDay: 10 });
      const res2 = makeResource({ id: "res-2", maxBatchesPerDay: 5 });
      const batches = [
        makeBatch({ id: "b1", planResourceId: "res-1", planDate: "2025-03-15" }),
      ];
      const ctx = makeContext({ batches, resources: [res1, res2] });
      const report = scorer.evaluate(ctx);
      const underUtil = report.issues.filter((i) => i.type === "under_utilization");
      expect(underUtil).toHaveLength(1);
      expect(underUtil[0]!.suggestedAction).not.toBeNull();
      expect(underUtil[0]!.suggestedAction!.targetResourceId).toBe("res-2");
      expect(underUtil[0]!.suggestedAction!.placementScore).toBeGreaterThan(0);
    });

    it("returns null suggestedAction when no feasible alternative resource exists", () => {
      // Only one active resource → no alternative to consolidate onto
      const resource = makeResource({ id: "res-1", maxBatchesPerDay: 10 });
      const batches = [
        makeBatch({ id: "b1", planResourceId: "res-1", planDate: "2025-03-15" }),
      ];
      const ctx = makeContext({ batches, resources: [resource] });
      const report = scorer.evaluate(ctx);
      const underUtil = report.issues.filter((i) => i.type === "under_utilization");
      expect(underUtil).toHaveLength(1);
      expect(underUtil[0]!.suggestedAction).toBeNull();
    });

    it("returns null suggestedAction when all alternative resources are blocked", () => {
      // res-1 is under-utilized, res-2 is blocked on that date
      const res1 = makeResource({ id: "res-1", maxBatchesPerDay: 10 });
      const res2 = makeResource({ id: "res-2", maxBatchesPerDay: 5 });
      const batches = [
        makeBatch({ id: "b1", planResourceId: "res-1", planDate: "2025-03-15" }),
      ];
      const ctx = makeContext({
        batches,
        resources: [res1, res2],
        resourceBlocks: [
          { resourceId: "res-2", startDate: "2025-03-14", endDate: "2025-03-16" },
        ],
      });
      const report = scorer.evaluate(ctx);
      const underUtil = report.issues.filter((i) => i.type === "under_utilization");
      expect(underUtil).toHaveLength(1);
      expect(underUtil[0]!.suggestedAction).toBeNull();
    });

    it("returns null suggestedAction when all alternative resources are inactive", () => {
      const res1 = makeResource({ id: "res-1", maxBatchesPerDay: 10 });
      const res2 = makeResource({ id: "res-2", maxBatchesPerDay: 5, active: false });
      const batches = [
        makeBatch({ id: "b1", planResourceId: "res-1", planDate: "2025-03-15" }),
      ];
      const ctx = makeContext({ batches, resources: [res1, res2] });
      const report = scorer.evaluate(ctx);
      const underUtil = report.issues.filter((i) => i.type === "under_utilization");
      expect(underUtil).toHaveLength(1);
      expect(underUtil[0]!.suggestedAction).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Rule violations
  // -----------------------------------------------------------------------

  describe("rule violations", () => {
    it("detects chemical base mismatch", () => {
      const resource = makeResource({ id: "res-1", chemicalBase: "water" });
      const batch = makeBatch({ id: "b1", chemicalBase: "solvent", planResourceId: "res-1" });
      const ctx = makeContext({ batches: [batch], resources: [resource] });
      const report = scorer.evaluate(ctx);
      const ruleIssues = report.issues.filter((i) => i.type === "rule_violation");
      expect(ruleIssues).toHaveLength(1);
      expect(ruleIssues[0]!.severity).toBe("warning");
      expect(ruleIssues[0]!.message).toContain("Chemical base mismatch");
    });

    it("no rule violation when chemical bases match", () => {
      const resource = makeResource({ id: "res-1", chemicalBase: "water" });
      const batch = makeBatch({ id: "b1", chemicalBase: "water", planResourceId: "res-1" });
      const ctx = makeContext({ batches: [batch], resources: [resource] });
      const report = scorer.evaluate(ctx);
      const ruleIssues = report.issues.filter((i) => i.type === "rule_violation");
      expect(ruleIssues).toHaveLength(0);
    });

    it("no rule violation when either chemical base is null", () => {
      const resource = makeResource({ id: "res-1", chemicalBase: null });
      const batch = makeBatch({ id: "b1", chemicalBase: "solvent", planResourceId: "res-1" });
      const ctx = makeContext({ batches: [batch], resources: [resource] });
      const report = scorer.evaluate(ctx);
      const ruleIssues = report.issues.filter((i) => i.type === "rule_violation");
      expect(ruleIssues).toHaveLength(0);
    });

    it("detects batch scheduled on blocked resource", () => {
      const resource = makeResource({ id: "res-1" });
      const batch = makeBatch({ id: "b1", planResourceId: "res-1", planDate: "2025-03-15" });
      const ctx = makeContext({
        batches: [batch],
        resources: [resource],
        resourceBlocks: [
          { resourceId: "res-1", startDate: "2025-03-14", endDate: "2025-03-16" },
        ],
      });
      const report = scorer.evaluate(ctx);
      const ruleIssues = report.issues.filter((i) => i.type === "rule_violation");
      expect(ruleIssues).toHaveLength(1);
      expect(ruleIssues[0]!.message).toContain("blocked");
    });

    it("no rule violation when resource block does not overlap", () => {
      const resource = makeResource({ id: "res-1" });
      const batch = makeBatch({ id: "b1", planResourceId: "res-1", planDate: "2025-03-15" });
      const ctx = makeContext({
        batches: [batch],
        resources: [resource],
        resourceBlocks: [
          { resourceId: "res-1", startDate: "2025-03-16", endDate: "2025-03-20" },
        ],
      });
      const report = scorer.evaluate(ctx);
      const ruleIssues = report.issues.filter((i) => i.type === "rule_violation");
      expect(ruleIssues).toHaveLength(0);
    });

    it("suggests alternative resource for rule violations", () => {
      const res1 = makeResource({ id: "res-1", chemicalBase: "water" });
      const res2 = makeResource({ id: "res-2", chemicalBase: "solvent" });
      const batch = makeBatch({ id: "b1", chemicalBase: "solvent", planResourceId: "res-1" });
      const ctx = makeContext({ batches: [batch], resources: [res1, res2] });
      const report = scorer.evaluate(ctx);
      const ruleIssues = report.issues.filter((i) => i.type === "rule_violation");
      expect(ruleIssues).toHaveLength(1);
      const suggestion = ruleIssues[0]!.suggestedAction;
      expect(suggestion).not.toBeNull();
      expect(suggestion!.targetResourceId).toBe("res-2");
    });
  });

  // -----------------------------------------------------------------------
  // Report structure
  // -----------------------------------------------------------------------

  describe("report structure", () => {
    it("includes issueCounts for all issue types", () => {
      const ctx = makeContext({
        batches: [makeBatch()],
        resources: [makeResource()],
      });
      const report = scorer.evaluate(ctx);
      const expectedTypes: HealthIssueType[] = [
        "capacity_overload",
        "colour_violation",
        "wom",
        "wop",
        "under_utilization",
        "unassigned",
        "rule_violation",
      ];
      for (const type of expectedTypes) {
        expect(report.issueCounts[type]).toBeDefined();
        expect(typeof report.issueCounts[type]).toBe("number");
      }
    });

    it("includes generatedAt timestamp", () => {
      const ctx = makeContext({
        batches: [],
        resources: [makeResource()],
      });
      const report = scorer.evaluate(ctx);
      expect(report.generatedAt).toBeDefined();
      expect(new Date(report.generatedAt).getTime()).not.toBeNaN();
    });

    it("includes summary message", () => {
      const ctx = makeContext({
        batches: [makeBatch({ planResourceId: null, planDate: null })],
        resources: [makeResource()],
      });
      const report = scorer.evaluate(ctx);
      expect(report.summary).toContain("issue");
    });

    it("summary says healthy when no issues", () => {
      const ctx = makeContext({
        batches: [makeBatch()],
        resources: [makeResource({ maxBatchesPerDay: 3 })],
      });
      const report = scorer.evaluate(ctx);
      expect(report.summary).toContain("healthy");
    });

    it("issues are sorted by severity: critical first", () => {
      const resource = makeResource({ id: "res-1", maxBatchesPerDay: 1, chemicalBase: "water" });
      const batches = [
        // Will generate capacity_overload (critical)
        makeBatch({ id: "b1", planResourceId: "res-1", planDate: "2025-03-15" }),
        makeBatch({ id: "b2", planResourceId: "res-1", planDate: "2025-03-15" }),
        // Will generate rule_violation (warning) via chemical base mismatch
        makeBatch({ id: "b3", planResourceId: "res-1", planDate: "2025-03-16", chemicalBase: "solvent" }),
      ];
      const ctx = makeContext({ batches, resources: [resource] });
      const report = scorer.evaluate(ctx);
      if (report.issues.length >= 2) {
        const severities = report.issues.map((i) => i.severity);
        const criticalIdx = severities.indexOf("critical");
        const warningIdx = severities.indexOf("warning");
        if (criticalIdx >= 0 && warningIdx >= 0) {
          expect(criticalIdx).toBeLessThan(warningIdx);
        }
      }
    });
  });

  // -----------------------------------------------------------------------
  // Deduplication
  // -----------------------------------------------------------------------

  describe("deduplication", () => {
    it("deduplicates issues by batch+type, keeping highest severity", () => {
      // A batch that both exceeds volume capacity AND is over the daily limit
      // should only produce one capacity_overload issue
      const resource = makeResource({ id: "res-1", maxCapacity: 400, maxBatchesPerDay: 1 });
      const batches = [
        makeBatch({ id: "b1", batchVolume: 500, planResourceId: "res-1", planDate: "2025-03-15" }),
        makeBatch({ id: "b1-dup", planResourceId: "res-1", planDate: "2025-03-15" }),
      ];
      const ctx = makeContext({ batches, resources: [resource] });
      const report = scorer.evaluate(ctx);
      // Check that b1 only appears once per issue type
      const b1Issues = report.issues.filter((i) => i.batchId === "b1");
      const b1Types = b1Issues.map((i) => i.type);
      expect(new Set(b1Types).size).toBe(b1Types.length);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe("edge cases", () => {
    it("handles empty batch list", () => {
      const ctx = makeContext({ batches: [], resources: [makeResource()] });
      const report = scorer.evaluate(ctx);
      expect(report.score).toBe(100);
      expect(report.issues).toHaveLength(0);
    });

    it("handles empty resource list", () => {
      const ctx = makeContext({
        batches: [makeBatch({ planResourceId: null, planDate: null })],
        resources: [],
      });
      const report = scorer.evaluate(ctx);
      expect(report.issues.length).toBeGreaterThan(0);
    });

    it("handles batches assigned to non-existent resources", () => {
      const ctx = makeContext({
        batches: [makeBatch({ planResourceId: "ghost-res", planDate: "2025-03-15" })],
        resources: [makeResource({ id: "res-1" })],
      });
      // Should not throw – ghost resource just gets skipped for resource-based checks
      const report = scorer.evaluate(ctx);
      expect(report).toBeDefined();
    });

    it("handles multiple resources and dates", () => {
      // maxBatchesPerDay=3 so 1 batch/resource/date = 33% ≥ 30%, no under_utilization
      const res1 = makeResource({ id: "res-1", maxBatchesPerDay: 3 });
      const res2 = makeResource({ id: "res-2", maxBatchesPerDay: 3 });
      const batches = [
        makeBatch({ id: "b1", planResourceId: "res-1", planDate: "2025-03-15" }),
        makeBatch({ id: "b2", planResourceId: "res-1", planDate: "2025-03-16" }),
        makeBatch({ id: "b3", planResourceId: "res-2", planDate: "2025-03-15" }),
      ];
      const ctx = makeContext({ batches, resources: [res1, res2] });
      const report = scorer.evaluate(ctx);
      expect(report.score).toBe(100);
    });

    it("is deterministic: same input produces same output", () => {
      const ctx = makeContext({
        batches: [
          makeBatch({ id: "b1", rmAvailable: false, rmAvailableDate: null }),
          makeBatch({ id: "b2", planResourceId: null, planDate: null }),
        ],
        resources: [makeResource()],
      });
      const report1 = scorer.evaluate(ctx);
      const report2 = scorer.evaluate(ctx);
      expect(report1.score).toBe(report2.score);
      expect(report1.issues.length).toBe(report2.issues.length);
      expect(report1.issueCounts).toEqual(report2.issueCounts);
    });
  });

  // -----------------------------------------------------------------------
  // Mixed issues (integration)
  // -----------------------------------------------------------------------

  describe("mixed issues integration", () => {
    it("combines multiple issue types in a single report", () => {
      const resource = makeResource({ id: "res-1", maxBatchesPerDay: 2, chemicalBase: "water" });
      const batches = [
        // capacity_overload: 3 batches on maxBatchesPerDay=2
        makeBatch({ id: "b1", planResourceId: "res-1", planDate: "2025-03-15" }),
        makeBatch({ id: "b2", planResourceId: "res-1", planDate: "2025-03-15" }),
        makeBatch({ id: "b3", planResourceId: "res-1", planDate: "2025-03-15" }),
        // unassigned
        makeBatch({ id: "b4", planResourceId: null, planDate: null }),
        // wom
        makeBatch({ id: "b5", rmAvailable: false, rmAvailableDate: null, planResourceId: "res-1", planDate: "2025-03-16" }),
        // rule_violation: chemical base
        makeBatch({ id: "b6", chemicalBase: "solvent", planResourceId: "res-1", planDate: "2025-03-17" }),
      ];
      const ctx = makeContext({ batches, resources: [resource] });
      const report = scorer.evaluate(ctx);

      expect(report.issueCounts.capacity_overload).toBeGreaterThanOrEqual(1);
      expect(report.issueCounts.unassigned).toBe(1);
      expect(report.issueCounts.wom).toBe(1);
      expect(report.issueCounts.rule_violation).toBeGreaterThanOrEqual(1);
      expect(report.score).toBeLessThan(100);
    });

    it("score decreases as more issues are added", () => {
      const resource = makeResource({ id: "res-1" });

      // Healthy schedule
      const ctx1 = makeContext({
        batches: [makeBatch({ id: "b1", planResourceId: "res-1" })],
        resources: [resource],
      });

      // Schedule with issues
      const ctx2 = makeContext({
        batches: [
          makeBatch({ id: "b1", planResourceId: "res-1" }),
          makeBatch({ id: "b2", planResourceId: null, planDate: null }),
          makeBatch({ id: "b3", planResourceId: null, planDate: null }),
        ],
        resources: [resource],
      });

      const report1 = scorer.evaluate(ctx1);
      const report2 = scorer.evaluate(ctx2);
      expect(report2.score).toBeLessThan(report1.score);
    });
  });

  // -----------------------------------------------------------------------
  // Factory function
  // -----------------------------------------------------------------------

  describe("createHealthScorer", () => {
    it("creates a HealthScorer with given PlacementScorer", () => {
      const placementScorer = new PlacementScorer(DEFAULT_SCORING_WEIGHTS);
      const healthScorer = createHealthScorer(placementScorer);
      expect(healthScorer).toBeInstanceOf(HealthScorer);
      expect(healthScorer.placementScorer).toBe(placementScorer);
    });

    it("creates a HealthScorer with custom health weights", () => {
      const placementScorer = new PlacementScorer(DEFAULT_SCORING_WEIGHTS);
      const customWeights: HealthScoringWeights = {
        ...DEFAULT_HEALTH_WEIGHTS,
        unassigned: 25,
      };
      const healthScorer = createHealthScorer(placementScorer, customWeights);
      expect(healthScorer.defaultHealthWeights.unassigned).toBe(25);
    });
  });
});
