import { describe, expect, it } from "vitest";
import { resourceFormSchema } from "./resource";

describe("resourceFormSchema", () => {
  it("accepts valid resource configuration", () => {
    const result = resourceFormSchema.parse({
      resourceCode: "MIX_01",
      resourceType: "mixer",
      displayName: "Mixer 01",
      trunkLine: "A",
      groupName: "G1",
      minCapacity: 100,
      maxCapacity: 500,
      maxBatchesPerDay: 3,
      chemicalBase: "WB",
      sortOrder: 1,
      active: true,
    });

    expect(result.resourceCode).toBe("MIX_01");
  });

  it("rejects invalid resource code characters", () => {
    const result = resourceFormSchema.safeParse({
      resourceCode: "MIX 01",
      resourceType: "mixer",
      maxBatchesPerDay: 1,
      sortOrder: 0,
      active: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("Only letters, numbers"))).toBe(true);
    }
  });

  it("rejects when minCapacity is greater than maxCapacity", () => {
    const result = resourceFormSchema.safeParse({
      resourceCode: "MIX-01",
      resourceType: "mixer",
      minCapacity: 500,
      maxCapacity: 100,
      maxBatchesPerDay: 1,
      sortOrder: 0,
      active: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("Min capacity");
    }
  });
});
