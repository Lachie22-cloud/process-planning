import { describe, expect, it } from "vitest";
import { parsePackSizeLitres } from "@/lib/utils/pack-size";

describe("parsePackSizeLitres", () => {
  it("parses millilitre strings", () => {
    expect(parsePackSizeLitres("500ml")).toBe(0.5);
    expect(parsePackSizeLitres("250ml")).toBe(0.25);
    expect(parsePackSizeLitres("1000ml")).toBe(1);
  });

  it("parses litre strings", () => {
    expect(parsePackSizeLitres("1L")).toBe(1);
    expect(parsePackSizeLitres("2.5L")).toBe(2.5);
    expect(parsePackSizeLitres("10l")).toBe(10);
    expect(parsePackSizeLitres("20L")).toBe(20);
  });

  it("is case-insensitive", () => {
    expect(parsePackSizeLitres("500ML")).toBe(0.5);
    expect(parsePackSizeLitres("2L")).toBe(2);
    expect(parsePackSizeLitres("2l")).toBe(2);
  });

  it("handles whitespace", () => {
    expect(parsePackSizeLitres("  500ml  ")).toBe(0.5);
    expect(parsePackSizeLitres("500 ml")).toBe(0.5);
    expect(parsePackSizeLitres("2.5 L")).toBe(2.5);
  });

  it("returns null for null/empty/unparseable", () => {
    expect(parsePackSizeLitres(null)).toBeNull();
    expect(parsePackSizeLitres("")).toBeNull();
    expect(parsePackSizeLitres("large")).toBeNull();
    expect(parsePackSizeLitres("abc")).toBeNull();
  });

  it("classifies small items (≤3L) correctly", () => {
    // These should be ≤ 3L
    expect(parsePackSizeLitres("500ml")! <= 3).toBe(true);
    expect(parsePackSizeLitres("1L")! <= 3).toBe(true);
    expect(parsePackSizeLitres("2.5L")! <= 3).toBe(true);
    expect(parsePackSizeLitres("3L")! <= 3).toBe(true);

    // These should be > 3L
    expect(parsePackSizeLitres("4L")! <= 3).toBe(false);
    expect(parsePackSizeLitres("10L")! <= 3).toBe(false);
    expect(parsePackSizeLitres("20L")! <= 3).toBe(false);
  });

  it("identifies 500ml items", () => {
    expect(parsePackSizeLitres("500ml")).toBe(0.5);
    expect(parsePackSizeLitres("0.5L")).toBe(0.5);
    expect(parsePackSizeLitres("0.5l")).toBe(0.5);
  });
});
