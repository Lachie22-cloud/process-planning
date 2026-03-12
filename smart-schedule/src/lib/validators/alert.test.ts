import { describe, expect, it } from "vitest";
import { bulkAlertFormSchema } from "./alert";

describe("bulkAlertFormSchema", () => {
  it("accepts a valid payload and normalises nullable optional fields", () => {
    const result = bulkAlertFormSchema.parse({
      message: "Material shortage",
      bulkCode: "",
      batchId: null,
      startDate: "2026-01-01",
      endDate: "2026-01-01",
    });

    expect(result.bulkCode).toBeNull();
    expect(result.batchId).toBeNull();
  });

  it("rejects endDate before startDate", () => {
    const result = bulkAlertFormSchema.safeParse({
      message: "Date check",
      startDate: "2026-02-02",
      endDate: "2026-02-01",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("End date must be on or after start date");
    }
  });
});
