import { describe, expect, it } from "vitest";
import { siteFormSchema } from "./site";

describe("siteFormSchema", () => {
  it("accepts valid super-admin site payload", () => {
    const result = siteFormSchema.parse({
      name: "Rocklea",
      code: "ROCKLEA_1",
      timezone: "Australia/Brisbane",
      weekEndDay: 5,
      scheduleHorizon: 7,
      active: true,
    });

    expect(result.code).toBe("ROCKLEA_1");
  });

  it("rejects lowercase or spaced site codes", () => {
    const result = siteFormSchema.safeParse({
      name: "Rocklea",
      code: "rocklea 1",
      timezone: "Australia/Brisbane",
      weekEndDay: 5,
      scheduleHorizon: 7,
      active: true,
    });

    expect(result.success).toBe(false);
  });

  it("enforces schedule horizon bounds", () => {
    const result = siteFormSchema.safeParse({
      name: "Rocklea",
      code: "ROCKLEA",
      timezone: "Australia/Brisbane",
      weekEndDay: 5,
      scheduleHorizon: 31,
      active: true,
    });

    expect(result.success).toBe(false);
  });
});
