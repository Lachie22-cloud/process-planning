import { describe, expect, it } from "vitest";
import {
  parseJsonObject,
  scheduleRuleFormSchema,
  substitutionRuleFormSchema,
} from "./rule";

describe("scheduleRuleFormSchema", () => {
  it("accepts valid JSON object strings", () => {
    const result = scheduleRuleFormSchema.parse({
      name: "Rule A",
      description: "desc",
      ruleType: "schedule",
      conditionsText: '{"a":1}',
      actionsText: '{"b":2}',
      enabled: true,
      ruleVersion: 1,
    });

    expect(result.ruleType).toBe("schedule");
  });

  it("rejects invalid JSON strings", () => {
    const result = scheduleRuleFormSchema.safeParse({
      name: "Rule A",
      description: null,
      ruleType: "schedule",
      conditionsText: "{not-json}",
      actionsText: "{}",
      enabled: true,
      ruleVersion: 1,
    });

    expect(result.success).toBe(false);
  });
});

describe("substitutionRuleFormSchema", () => {
  it("requires at least one resource id", () => {
    const result = substitutionRuleFormSchema.safeParse({
      sourceResourceId: null,
      targetResourceId: null,
      conditions: null,
      enabled: true,
    });

    expect(result.success).toBe(false);
  });

  it("rejects identical source and target ids", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const result = substitutionRuleFormSchema.safeParse({
      sourceResourceId: id,
      targetResourceId: id,
      conditions: null,
      enabled: true,
    });

    expect(result.success).toBe(false);
  });

  it("rejects minVolume larger than maxVolume", () => {
    const result = substitutionRuleFormSchema.safeParse({
      sourceResourceId: "11111111-1111-1111-1111-111111111111",
      targetResourceId: "22222222-2222-2222-2222-222222222222",
      conditions: { minVolume: 10, maxVolume: 1 },
      enabled: true,
    });

    expect(result.success).toBe(false);
  });
});

describe("parseJsonObject", () => {
  it("returns null for empty or {}", () => {
    expect(parseJsonObject("  ")).toBeNull();
    expect(parseJsonObject("{}")).toBeNull();
  });

  it("returns object for valid JSON object", () => {
    expect(parseJsonObject('{"x":1}')).toEqual({ x: 1 });
  });

  it("returns null for invalid or non-object JSON", () => {
    expect(parseJsonObject("[]")).toBeNull();
    expect(parseJsonObject("not-json")).toBeNull();
  });
});
