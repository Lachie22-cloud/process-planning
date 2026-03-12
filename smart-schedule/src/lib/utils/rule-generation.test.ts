import { beforeEach, describe, expect, it } from "vitest";
import { generateSubstitutionRules } from "./rule-generation";
import type { Resource } from "@/types/resource";
import type { SubstitutionRule } from "@/types/rule";
import type { SubstitutionGenerationConfig } from "@/lib/validators/substitution-generation-settings";
import { DEFAULT_GENERATION_CONFIG } from "@/lib/constants/substitution-generation-defaults";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

let idCounter = 0;

function makeResource(overrides: Partial<Resource> = {}): Resource {
  idCounter++;
  return {
    id: `resource-${idCounter.toString().padStart(3, "0")}`,
    siteId: "site-001",
    resourceCode: `MX${idCounter}`,
    resourceType: "mixer",
    displayName: `Mixer ${idCounter}`,
    trunkLine: "TL-A",
    groupName: "Group A",
    minCapacity: 100,
    maxCapacity: 500,
    maxBatchesPerDay: 4,
    chemicalBase: "water",
    sortOrder: idCounter,
    active: true,
    config: {},
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeRule(overrides: Partial<SubstitutionRule> = {}): SubstitutionRule {
  return {
    id: "rule-001",
    siteId: "site-001",
    sourceResourceId: null,
    targetResourceId: null,
    conditions: null,
    enabled: true,
    createdBy: null,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeConfig(
  overrides: Partial<{
    [K in keyof SubstitutionGenerationConfig]: Partial<SubstitutionGenerationConfig[K]>;
  }> = {},
): SubstitutionGenerationConfig {
  return {
    scope: { ...DEFAULT_GENERATION_CONFIG.scope, ...overrides.scope },
    capacityStrategy: {
      ...DEFAULT_GENERATION_CONFIG.capacityStrategy,
      ...overrides.capacityStrategy,
    },
    resourceEligibility: {
      ...DEFAULT_GENERATION_CONFIG.resourceEligibility,
      ...overrides.resourceEligibility,
    },
    safety: { ...DEFAULT_GENERATION_CONFIG.safety, ...overrides.safety },
    conditionTemplates: {
      ...DEFAULT_GENERATION_CONFIG.conditionTemplates,
      ...overrides.conditionTemplates,
    },
  };
}

// Reset counter between describes
beforeEach(() => {
  idCounter = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateSubstitutionRules", () => {
  // -----------------------------------------------------------------------
  // Empty / edge cases
  // -----------------------------------------------------------------------
  describe("empty and edge cases", () => {
    it("returns empty result for empty resource list", () => {
      const result = generateSubstitutionRules([], makeConfig(), []);
      expect(result.candidates).toEqual([]);
      expect(result.skippedCount).toBe(0);
      expect(result.totalPairsEvaluated).toBe(0);
    });

    it("returns empty result for single resource", () => {
      const r = makeResource();
      const result = generateSubstitutionRules([r], makeConfig(), []);
      expect(result.candidates).toEqual([]);
      expect(result.totalPairsEvaluated).toBe(0);
    });

    it("returns empty result when all resources are inactive and includeInactive is false", () => {
      const r1 = makeResource({ active: false });
      const r2 = makeResource({ active: false });
      const result = generateSubstitutionRules([r1, r2], makeConfig(), []);
      expect(result.candidates).toEqual([]);
    });

    it("returns empty result when all resources lack group names and excludeMissingFields is true", () => {
      const r1 = makeResource({ groupName: null });
      const r2 = makeResource({ groupName: null });
      const result = generateSubstitutionRules([r1, r2], makeConfig(), []);
      expect(result.candidates).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Same-group pairs
  // -----------------------------------------------------------------------
  describe("same-group pairing", () => {
    it("generates bidirectional pairs for two resources in the same group", () => {
      const r1 = makeResource({ groupName: "Group A", chemicalBase: "water" });
      const r2 = makeResource({ groupName: "Group A", chemicalBase: "water" });
      const config = makeConfig();

      const result = generateSubstitutionRules([r1, r2], config, []);

      expect(result.candidates).toHaveLength(2);
      expect(result.totalPairsEvaluated).toBe(2);

      const pairs = result.candidates.map(
        (c) => `${c.sourceResourceId}→${c.targetResourceId}`,
      );
      expect(pairs).toContain(`${r1.id}→${r2.id}`);
      expect(pairs).toContain(`${r2.id}→${r1.id}`);
    });

    it("generates N*(N-1) pairs for N resources in the same group", () => {
      const resources = Array.from({ length: 4 }, () =>
        makeResource({ groupName: "Group A", chemicalBase: "water" }),
      );
      const result = generateSubstitutionRules(resources, makeConfig(), []);
      expect(result.candidates).toHaveLength(12); // 4 * 3
    });

    it("does not pair resources from different groups when crossGroup is false", () => {
      const r1 = makeResource({ groupName: "Group A", chemicalBase: "water" });
      const r2 = makeResource({ groupName: "Group B", chemicalBase: "water" });
      const config = makeConfig({ scope: { crossGroup: false } });

      const result = generateSubstitutionRules([r1, r2], config, []);
      expect(result.candidates).toHaveLength(0);
    });

    it("does not generate same-group pairs when sameGroup is false", () => {
      const r1 = makeResource({ groupName: "Group A", chemicalBase: "water" });
      const r2 = makeResource({ groupName: "Group A", chemicalBase: "water" });
      const config = makeConfig({ scope: { sameGroup: false } });

      const result = generateSubstitutionRules([r1, r2], config, []);
      expect(result.candidates).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Cross-group skipping
  // -----------------------------------------------------------------------
  describe("cross-group skipping", () => {
    it("skips cross-group pairs when crossGroup is false", () => {
      const r1 = makeResource({
        groupName: "Group A",
        trunkLine: "TL-A",
        chemicalBase: "water",
      });
      const r2 = makeResource({
        groupName: "Group B",
        trunkLine: "TL-A",
        chemicalBase: "water",
      });
      const config = makeConfig({ scope: { crossGroup: false } });

      const result = generateSubstitutionRules([r1, r2], config, []);
      expect(result.candidates).toHaveLength(0);
    });

    it("allows cross-group pairs when crossGroup is true and same trunk line", () => {
      const r1 = makeResource({
        groupName: "Group A",
        trunkLine: "TL-A",
        chemicalBase: "water",
      });
      const r2 = makeResource({
        groupName: "Group B",
        trunkLine: "TL-A",
        chemicalBase: "water",
      });
      const config = makeConfig({ scope: { crossGroup: true } });

      const result = generateSubstitutionRules([r1, r2], config, []);
      expect(result.candidates).toHaveLength(2);
    });

    it("blocks cross-group pairs with different trunk lines when crossTrunkLine is false", () => {
      const r1 = makeResource({
        groupName: "Group A",
        trunkLine: "TL-A",
        chemicalBase: "water",
      });
      const r2 = makeResource({
        groupName: "Group B",
        trunkLine: "TL-B",
        chemicalBase: "water",
      });
      const config = makeConfig({
        scope: { crossGroup: true, crossTrunkLine: false },
      });

      const result = generateSubstitutionRules([r1, r2], config, []);
      expect(result.candidates).toHaveLength(0);
    });

    it("allows cross-group + cross-trunk pairs when both flags are true", () => {
      const r1 = makeResource({
        groupName: "Group A",
        trunkLine: "TL-A",
        chemicalBase: "water",
      });
      const r2 = makeResource({
        groupName: "Group B",
        trunkLine: "TL-B",
        chemicalBase: "water",
      });
      const config = makeConfig({
        scope: { crossGroup: true, crossTrunkLine: true },
      });

      const result = generateSubstitutionRules([r1, r2], config, []);
      expect(result.candidates).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Chemical base filtering
  // -----------------------------------------------------------------------
  describe("chemical base filtering", () => {
    it("blocks pairs with different chemical bases when crossChemicalBase is false", () => {
      const r1 = makeResource({
        groupName: "Group A",
        chemicalBase: "water",
      });
      const r2 = makeResource({
        groupName: "Group A",
        chemicalBase: "solvent",
      });
      const config = makeConfig({ scope: { crossChemicalBase: false } });

      const result = generateSubstitutionRules([r1, r2], config, []);
      expect(result.candidates).toHaveLength(0);
    });

    it("allows pairs with different chemical bases when crossChemicalBase is true", () => {
      const r1 = makeResource({
        groupName: "Group A",
        chemicalBase: "water",
      });
      const r2 = makeResource({
        groupName: "Group A",
        chemicalBase: "solvent",
      });
      const config = makeConfig({ scope: { crossChemicalBase: true } });

      const result = generateSubstitutionRules([r1, r2], config, []);
      expect(result.candidates).toHaveLength(2);
    });

    it("blocks pairs where either resource has null chemicalBase when crossChemicalBase is false", () => {
      const r1 = makeResource({
        groupName: "Group A",
        chemicalBase: "water",
      });
      const r2 = makeResource({
        groupName: "Group A",
        chemicalBase: null,
      });
      const config = makeConfig({ scope: { crossChemicalBase: false } });

      const result = generateSubstitutionRules([r1, r2], config, []);
      expect(result.candidates).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Capacity-based conditions
  // -----------------------------------------------------------------------
  describe("capacity-based conditions", () => {
    it("sets maxVolume condition for large-to-small substitution", () => {
      const r1 = makeResource({
        groupName: "Group A",
        chemicalBase: "water",
        maxCapacity: 1000,
        minCapacity: 200,
      });
      const r2 = makeResource({
        groupName: "Group A",
        chemicalBase: "water",
        maxCapacity: 500,
        minCapacity: 100,
      });
      const config = makeConfig({
        capacityStrategy: { largeToSmallTemplate: "maxVolume" },
      });

      const result = generateSubstitutionRules([r1, r2], config, []);

      // r1→r2 is large-to-small
      const largeToSmall = result.candidates.find(
        (c) => c.sourceResourceId === r1.id && c.targetResourceId === r2.id,
      );
      expect(largeToSmall?.conditions).toEqual({ maxVolume: 500 });
    });

    it("sets minVolume condition for small-to-large substitution", () => {
      const r1 = makeResource({
        groupName: "Group A",
        chemicalBase: "water",
        maxCapacity: 500,
        minCapacity: 100,
      });
      const r2 = makeResource({
        groupName: "Group A",
        chemicalBase: "water",
        maxCapacity: 1000,
        minCapacity: 200,
      });
      const config = makeConfig({
        capacityStrategy: { smallToLargeTemplate: "minVolume" },
      });

      const result = generateSubstitutionRules([r1, r2], config, []);

      // r1→r2 is small-to-large
      const smallToLarge = result.candidates.find(
        (c) => c.sourceResourceId === r1.id && c.targetResourceId === r2.id,
      );
      expect(smallToLarge?.conditions).toEqual({ minVolume: 200 });
    });

    it("sets no conditions for same-capacity when sameCapacityTemplate is null", () => {
      const r1 = makeResource({
        groupName: "Group A",
        chemicalBase: "water",
        maxCapacity: 500,
        minCapacity: 100,
      });
      const r2 = makeResource({
        groupName: "Group A",
        chemicalBase: "water",
        maxCapacity: 500,
        minCapacity: 100,
      });
      const config = makeConfig({
        capacityStrategy: { sameCapacityTemplate: null },
      });

      const result = generateSubstitutionRules([r1, r2], config, []);

      for (const c of result.candidates) {
        expect(c.conditions).toBeNull();
      }
    });

    it("applies both min and max when applyBothMinMax is true", () => {
      const r1 = makeResource({
        groupName: "Group A",
        chemicalBase: "water",
        maxCapacity: 1000,
        minCapacity: 200,
      });
      const r2 = makeResource({
        groupName: "Group A",
        chemicalBase: "water",
        maxCapacity: 500,
        minCapacity: 100,
      });
      const config = makeConfig({
        capacityStrategy: {
          largeToSmallTemplate: "maxVolume",
          applyBothMinMax: true,
        },
      });

      const result = generateSubstitutionRules([r1, r2], config, []);

      // r1→r2 is large-to-small; applyBothMinMax overrides to "both"
      const largeToSmall = result.candidates.find(
        (c) => c.sourceResourceId === r1.id && c.targetResourceId === r2.id,
      );
      expect(largeToSmall?.conditions).toEqual({
        maxVolume: 500,
        minVolume: 100,
      });
    });

    it("returns null conditions when conditionTemplates disable the relevant field", () => {
      const r1 = makeResource({
        groupName: "Group A",
        chemicalBase: "water",
        maxCapacity: 1000,
      });
      const r2 = makeResource({
        groupName: "Group A",
        chemicalBase: "water",
        maxCapacity: 500,
      });
      const config = makeConfig({
        capacityStrategy: { largeToSmallTemplate: "maxVolume" },
        conditionTemplates: { maxVolume: false, minVolume: true },
      });

      const result = generateSubstitutionRules([r1, r2], config, []);

      const largeToSmall = result.candidates.find(
        (c) => c.sourceResourceId === r1.id && c.targetResourceId === r2.id,
      );
      expect(largeToSmall?.conditions).toBeNull();
    });

    it("returns null conditions when target has null capacity values", () => {
      const r1 = makeResource({
        groupName: "Group A",
        chemicalBase: "water",
        maxCapacity: 1000,
      });
      const r2 = makeResource({
        groupName: "Group A",
        chemicalBase: "water",
        maxCapacity: null,
        minCapacity: null,
      });
      // r1→r2: r1.maxCap(1000) > r2.maxCap(0) → large-to-small
      const config = makeConfig({
        capacityStrategy: { largeToSmallTemplate: "maxVolume" },
      });

      const result = generateSubstitutionRules([r1, r2], config, []);

      const rule = result.candidates.find(
        (c) => c.sourceResourceId === r1.id && c.targetResourceId === r2.id,
      );
      expect(rule?.conditions).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Duplicate detection
  // -----------------------------------------------------------------------
  describe("duplicate detection", () => {
    it("skips duplicates with policy 'skip'", () => {
      const r1 = makeResource({ groupName: "Group A", chemicalBase: "water" });
      const r2 = makeResource({ groupName: "Group A", chemicalBase: "water" });
      const existing = [
        makeRule({
          sourceResourceId: r1.id,
          targetResourceId: r2.id,
          enabled: true,
        }),
      ];
      const config = makeConfig({ safety: { duplicatePolicy: "skip" } });

      const result = generateSubstitutionRules([r1, r2], config, existing);

      const skipped = result.candidates.filter(
        (c) => c.duplicateStatus === "skipped",
      );
      expect(skipped).toHaveLength(1);
      expect(result.skippedCount).toBe(1);

      // The reverse pair (r2→r1) should still be new
      const newOnes = result.candidates.filter(
        (c) => c.duplicateStatus === "new",
      );
      expect(newOnes).toHaveLength(1);
      expect(newOnes[0]!.sourceResourceId).toBe(r2.id);
    });

    it("marks duplicates as upsert with policy 'upsert'", () => {
      const r1 = makeResource({ groupName: "Group A", chemicalBase: "water" });
      const r2 = makeResource({ groupName: "Group A", chemicalBase: "water" });
      const existing = [
        makeRule({
          sourceResourceId: r1.id,
          targetResourceId: r2.id,
          enabled: true,
        }),
      ];
      const config = makeConfig({ safety: { duplicatePolicy: "upsert" } });

      const result = generateSubstitutionRules([r1, r2], config, existing);

      const upserts = result.candidates.filter(
        (c) => c.duplicateStatus === "upsert",
      );
      expect(upserts).toHaveLength(1);
      expect(upserts[0]!.enabled).toBe(true);
    });

    it("creates disabled rules with policy 'create_disabled'", () => {
      const r1 = makeResource({ groupName: "Group A", chemicalBase: "water" });
      const r2 = makeResource({ groupName: "Group A", chemicalBase: "water" });
      const existing = [
        makeRule({
          sourceResourceId: r1.id,
          targetResourceId: r2.id,
          enabled: true,
        }),
      ];
      const config = makeConfig({
        safety: { duplicatePolicy: "create_disabled" },
      });

      const result = generateSubstitutionRules([r1, r2], config, existing);

      const disabled = result.candidates.filter(
        (c) => c.duplicateStatus === "created_disabled",
      );
      expect(disabled).toHaveLength(1);
      expect(disabled[0]!.enabled).toBe(false);
    });

    it("disabled rules are not treated as duplicates when disabledCountAsDuplicates is false", () => {
      const r1 = makeResource({ groupName: "Group A", chemicalBase: "water" });
      const r2 = makeResource({ groupName: "Group A", chemicalBase: "water" });
      const existing = [
        makeRule({
          sourceResourceId: r1.id,
          targetResourceId: r2.id,
          enabled: false,
        }),
      ];
      const config = makeConfig({
        safety: {
          duplicatePolicy: "skip",
          disabledCountAsDuplicates: false,
        },
      });

      const result = generateSubstitutionRules([r1, r2], config, existing);

      // The disabled existing rule should NOT be treated as duplicate
      const newOnes = result.candidates.filter(
        (c) =>
          c.sourceResourceId === r1.id &&
          c.targetResourceId === r2.id &&
          c.duplicateStatus === "new",
      );
      expect(newOnes).toHaveLength(1);
    });

    it("disabled rules ARE treated as duplicates when disabledCountAsDuplicates is true", () => {
      const r1 = makeResource({ groupName: "Group A", chemicalBase: "water" });
      const r2 = makeResource({ groupName: "Group A", chemicalBase: "water" });
      const existing = [
        makeRule({
          sourceResourceId: r1.id,
          targetResourceId: r2.id,
          enabled: false,
        }),
      ];
      const config = makeConfig({
        safety: {
          duplicatePolicy: "skip",
          disabledCountAsDuplicates: true,
        },
      });

      const result = generateSubstitutionRules([r1, r2], config, existing);

      const skipped = result.candidates.filter(
        (c) =>
          c.sourceResourceId === r1.id &&
          c.targetResourceId === r2.id &&
          c.duplicateStatus === "skipped",
      );
      expect(skipped).toHaveLength(1);
    });

    it("does not match duplicates on rules with null source/target", () => {
      const r1 = makeResource({ groupName: "Group A", chemicalBase: "water" });
      const r2 = makeResource({ groupName: "Group A", chemicalBase: "water" });
      const existing = [
        makeRule({
          sourceResourceId: null,
          targetResourceId: r2.id,
          enabled: true,
        }),
      ];
      const config = makeConfig({ safety: { duplicatePolicy: "skip" } });

      const result = generateSubstitutionRules([r1, r2], config, existing);

      // Wildcard rules (null source/target) should not match specific pairs
      const newOnes = result.candidates.filter(
        (c) => c.duplicateStatus === "new",
      );
      expect(newOnes).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Resource eligibility
  // -----------------------------------------------------------------------
  describe("resource eligibility", () => {
    it("excludes inactive resources when includeInactive is false", () => {
      const r1 = makeResource({
        groupName: "Group A",
        chemicalBase: "water",
        active: true,
      });
      const r2 = makeResource({
        groupName: "Group A",
        chemicalBase: "water",
        active: false,
      });
      const config = makeConfig({
        resourceEligibility: { includeInactive: false },
      });

      const result = generateSubstitutionRules([r1, r2], config, []);
      expect(result.candidates).toHaveLength(0); // only 1 eligible, can't pair
    });

    it("includes inactive resources when includeInactive is true", () => {
      const r1 = makeResource({
        groupName: "Group A",
        chemicalBase: "water",
        active: true,
      });
      const r2 = makeResource({
        groupName: "Group A",
        chemicalBase: "water",
        active: false,
      });
      const config = makeConfig({
        resourceEligibility: { includeInactive: true },
      });

      const result = generateSubstitutionRules([r1, r2], config, []);
      expect(result.candidates).toHaveLength(2);
    });

    it("excludes resources with null groupName when groupByKey is 'group'", () => {
      const r1 = makeResource({
        groupName: "Group A",
        chemicalBase: "water",
      });
      const r2 = makeResource({
        groupName: null,
        chemicalBase: "water",
      });
      const config = makeConfig({
        resourceEligibility: {
          excludeMissingFields: true,
          groupByKey: "group",
        },
      });

      const result = generateSubstitutionRules([r1, r2], config, []);
      expect(result.candidates).toHaveLength(0);
    });

    it("excludes resources with null trunkLine when groupByKey is 'trunk_line'", () => {
      const r1 = makeResource({
        trunkLine: "TL-A",
        chemicalBase: "water",
      });
      const r2 = makeResource({
        trunkLine: null,
        chemicalBase: "water",
      });
      const config = makeConfig({
        resourceEligibility: {
          excludeMissingFields: true,
          groupByKey: "trunk_line",
        },
      });

      const result = generateSubstitutionRules([r1, r2], config, []);
      expect(result.candidates).toHaveLength(0);
    });

    it("includes resources with null group fields when excludeMissingFields is false", () => {
      const r1 = makeResource({
        groupName: null,
        trunkLine: null,
        chemicalBase: "water",
      });
      const r2 = makeResource({
        groupName: null,
        trunkLine: null,
        chemicalBase: "water",
      });
      const config = makeConfig({
        resourceEligibility: { excludeMissingFields: false },
        scope: { sameGroup: true },
      });

      const result = generateSubstitutionRules([r1, r2], config, []);
      // Both have null groups but excludeMissingFields is false
      // They won't match same-group because null !== null for group comparison
      // So 0 candidates
      expect(result.candidates).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Grouping by key
  // -----------------------------------------------------------------------
  describe("grouping by key", () => {
    it("groups by trunk_line when groupByKey is 'trunk_line'", () => {
      const r1 = makeResource({
        groupName: "Group A",
        trunkLine: "TL-A",
        chemicalBase: "water",
      });
      const r2 = makeResource({
        groupName: "Group B",
        trunkLine: "TL-A",
        chemicalBase: "water",
      });
      const config = makeConfig({
        resourceEligibility: { groupByKey: "trunk_line" },
        scope: { sameGroup: true, crossGroup: false },
      });

      const result = generateSubstitutionRules([r1, r2], config, []);
      // Same trunk_line → same group → should pair
      expect(result.candidates).toHaveLength(2);
    });

    it("groups by both when groupByKey is 'both'", () => {
      const r1 = makeResource({
        groupName: "Group A",
        trunkLine: "TL-A",
        chemicalBase: "water",
      });
      const r2 = makeResource({
        groupName: "Group A",
        trunkLine: "TL-B",
        chemicalBase: "water",
      });
      const config = makeConfig({
        resourceEligibility: { groupByKey: "both" },
        scope: { sameGroup: true, crossGroup: false },
      });

      const result = generateSubstitutionRules([r1, r2], config, []);
      // Same groupName but different trunkLine → different composite key → no pairs
      expect(result.candidates).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Integration-style test
  // -----------------------------------------------------------------------
  describe("integration", () => {
    it("generates correct rules for a realistic small site", () => {
      // 3 mixers in Group A, 2 mixers in Group B, same trunk line
      const ga1 = makeResource({
        groupName: "Group A",
        trunkLine: "TL-1",
        chemicalBase: "water",
        maxCapacity: 1000,
        minCapacity: 200,
      });
      const ga2 = makeResource({
        groupName: "Group A",
        trunkLine: "TL-1",
        chemicalBase: "water",
        maxCapacity: 500,
        minCapacity: 100,
      });
      const ga3 = makeResource({
        groupName: "Group A",
        trunkLine: "TL-1",
        chemicalBase: "water",
        maxCapacity: 500,
        minCapacity: 100,
      });
      const gb1 = makeResource({
        groupName: "Group B",
        trunkLine: "TL-1",
        chemicalBase: "water",
        maxCapacity: 800,
        minCapacity: 150,
      });
      const gb2 = makeResource({
        groupName: "Group B",
        trunkLine: "TL-1",
        chemicalBase: "solvent",
        maxCapacity: 600,
        minCapacity: 120,
      });

      const config = makeConfig(); // defaults: same-group, no cross-group

      const result = generateSubstitutionRules(
        [ga1, ga2, ga3, gb1, gb2],
        config,
        [],
      );

      // Group A: 3 resources → 3*2 = 6 pairs
      // Group B: gb1 and gb2 have different chemicalBase, crossChemicalBase=false → 0 pairs
      expect(result.candidates).toHaveLength(6);
      expect(result.skippedCount).toBe(0);

      // Check that ga1→ga2 gets maxVolume from ga2 (large to small)
      const ga1_ga2 = result.candidates.find(
        (c) =>
          c.sourceResourceId === ga1.id && c.targetResourceId === ga2.id,
      );
      expect(ga1_ga2?.conditions).toEqual({ maxVolume: 500 });

      // Check that ga2→ga1 gets minVolume from ga1 (small to large)
      const ga2_ga1 = result.candidates.find(
        (c) =>
          c.sourceResourceId === ga2.id && c.targetResourceId === ga1.id,
      );
      expect(ga2_ga1?.conditions).toEqual({ minVolume: 200 });

      // Check that ga2→ga3 has no conditions (same capacity, sameCapacityTemplate=null)
      const ga2_ga3 = result.candidates.find(
        (c) =>
          c.sourceResourceId === ga2.id && c.targetResourceId === ga3.id,
      );
      expect(ga2_ga3?.conditions).toBeNull();
    });
  });
});
