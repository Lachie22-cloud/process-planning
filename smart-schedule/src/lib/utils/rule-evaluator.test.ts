import { describe, expect, it } from "vitest";
import { evaluateDropTarget } from "./rule-evaluator";
import type { Batch } from "@/types/batch";
import type { Resource } from "@/types/resource";
import type { ScheduleRule, SubstitutionRule } from "@/types/rule";

function makeBatch(overrides: Partial<Batch> = {}): Batch {
  return {
    id: "batch-001",
    siteId: "site-001",
    sapOrder: "100001",
    materialCode: null,
    materialDescription: null,
    bulkCode: "BULK-001",
    planDate: "2025-03-10",
    planResourceId: "resource-source",
    planDisperserId: null,
    batchVolume: 400,
    status: "Planned",
    sapColorGroup: "WHITE",
    packSize: null,
    rmAvailable: true,
    packagingAvailable: true,
    qcObservedStage: null,
    qcObservedAt: null,
    qcObservedBy: null,
    jobLocation: null,
    statusComment: null,
    statusChangedAt: null,
    statusChangedBy: null,
    stockCover: null,
    safetyStock: null,
    poDate: null,
    poQuantity: null,
    forecast: null,
    materialShortage: false,
    vettingStatus: "not_required",
    vettedBy: null,
    vettedAt: null,
    vettingComment: null,
    bulkBatchNumber: null,
    premixCount: 0,
    ipt: null,
    fillRequirement: null,
    observationRequired: false,
    ebrBatch: false,
    physicalLocation: null,
    createdAt: "2025-03-01T00:00:00.000Z",
    updatedAt: "2025-03-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeResource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: "resource-target",
    siteId: "site-001",
    resourceCode: "MIXER-2",
    resourceType: "mixer",
    displayName: "Mixer 2",
    trunkLine: null,
    groupName: null,
    minCapacity: 100,
    maxCapacity: 1000,
    maxBatchesPerDay: 4,
    active: true,
    chemicalBase: "water",
    sortOrder: 1,
    config: {},
    groupCapacity: null,
    createdAt: "2025-03-01T00:00:00.000Z",
    ...overrides,
  };
}

function evaluate(substitutionRules: SubstitutionRule[], batchOverrides: Partial<Batch> = {}) {
  return evaluateDropTarget({
    batch: makeBatch(batchOverrides),
    targetResource: makeResource(),
    targetDate: "2025-03-11",
    existingBatches: [],
    rules: [] as ScheduleRule[],
    colourGroups: [],
    colourTransitions: [],
    substitutionRules,
  });
}

describe("evaluateDropTarget substitution enforcement", () => {
  it("rejects mixer moves that are not allowed by any substitution rule", () => {
    const result = evaluate([
      {
        id: "rule-001",
        siteId: "site-001",
        sourceResourceId: "resource-other",
        targetResourceId: "resource-target",
        conditions: null,
        enabled: true,
        createdBy: null,
        createdAt: "2025-03-01T00:00:00.000Z",
      },
    ]);

    expect(result.valid).toBe(false);
    expect(result.warnings).toContain("No substitution rule allows this mixer change");
  });

  it("accepts mixer moves when a matching substitution rule exists", () => {
    const result = evaluate([
      {
        id: "rule-001",
        siteId: "site-001",
        sourceResourceId: "resource-source",
        targetResourceId: "resource-target",
        conditions: null,
        enabled: true,
        createdBy: null,
        createdAt: "2025-03-01T00:00:00.000Z",
      },
    ]);

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("rejects mixer moves when rule conditions do not match the batch", () => {
    const result = evaluate(
      [
        {
          id: "rule-001",
          siteId: "site-001",
          sourceResourceId: "resource-source",
          targetResourceId: "resource-target",
          conditions: { maxVolume: 300, colorGroups: ["WHITE"] },
          enabled: true,
          createdBy: null,
          createdAt: "2025-03-01T00:00:00.000Z",
        },
      ],
      { batchVolume: 400, sapColorGroup: "RED" },
    );

    expect(result.valid).toBe(false);
    expect(result.warnings).toContain("No substitution rule allows this mixer change");
  });
});
