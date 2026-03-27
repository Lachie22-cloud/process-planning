import { describe, expect, it } from "vitest";
import { batchSchema, batchStatusSchema } from "./batch";

describe("batch validators", () => {
  it("accepts all supported statuses", () => {
    const statuses = [
      "Planned",
      "In Progress",
      "In Lab",
      "On Test",
      "Ready to Fill",
      "Filling",
      "Job Complete",
      "NCB",
      "OFF Rework",
      "OFF WOM",
      "OFF WOP",
      "Hold",
    ] as const;

    for (const status of statuses) {
      expect(batchStatusSchema.parse(status)).toBe(status);
    }
  });

  it("validates a complete batch payload", () => {
    const result = batchSchema.parse({
      id: "11111111-1111-1111-1111-111111111111",
      siteId: "22222222-2222-2222-2222-222222222222",
      batchNumber: "B-100",
      productCode: "P-1",
      productName: "Product",
      quantity: 10,
      unit: "L",
      status: "Planned",
      priority: 5,
      colorGroup: null,
      scheduledDate: null,
      resourceId: null,
      qcStage: null,
      notes: null,
    });

    expect(result.status).toBe("Planned");
    expect(result.quantity).toBe(10);
  });

  it("rejects out-of-range priority", () => {
    const result = batchSchema.safeParse({
      id: "11111111-1111-1111-1111-111111111111",
      siteId: "22222222-2222-2222-2222-222222222222",
      batchNumber: "B-100",
      productCode: "P-1",
      productName: "Product",
      quantity: 10,
      unit: "L",
      status: "Planned",
      priority: 100,
      colorGroup: null,
      scheduledDate: null,
      resourceId: null,
      qcStage: null,
      notes: null,
    });

    expect(result.success).toBe(false);
  });
});
