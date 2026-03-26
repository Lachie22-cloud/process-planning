/**
 * Shortage Comparison Test
 *
 * Simulates real SAP Excel data (BOM requirements + SOH report) and verifies
 * the shortage calculations in processFilesToBatches match what you'd calculate
 * manually in a spreadsheet.
 *
 * Each test scenario mirrors a real-world case:
 *   - Excel "Required" column = sum of requirement quantities per material
 *   - Excel "SOH" column = unrestricted stock from SOH report
 *   - Excel "Short" = max(0, Required - SOH), shown as negative
 *
 * The cumulative drawdown model means order of consumption matters:
 *   If SOH=100 and Order A needs 80 and Order B needs 60,
 *   then Order A consumes 80 (remaining 20), Order B short by 40.
 */
import { describe, expect, it, vi } from "vitest";
import type { ParsedRow } from "@/lib/utils/excel-parser";
import { processFilesToBatches } from "./use-import";

vi.mock("@/lib/utils/excel-parser", () => ({
  parseExcelFile: vi.fn(),
  excelDateToISO: (value: unknown) => {
    if (typeof value === "string") return value;
    if (typeof value === "number") {
      const date = new Date((value - 25569) * 86400 * 1000);
      return date.toISOString().split("T")[0];
    }
    return null;
  },
}));

vi.mock("@/hooks/use-current-site", () => ({
  useCurrentSite: () => ({ site: { id: "site-1" } }),
}));

vi.mock("@/hooks/use-resources", () => ({
  useResources: () => ({ data: [] }),
}));

vi.mock("@/lib/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

/* ------------------------------------------------------------------ */
/*  Helper to build ParsedFile objects matching SAP export format       */
/* ------------------------------------------------------------------ */

function bulkData(rows: Record<string, string | number | null>[]) {
  const headers = [
    "Order", "Basic Start Date", "Material", "Material Description",
    "Total Order Quantity", "Colour Group",
  ];
  return {
    fileName: "bulk_data.xlsx",
    type: "bulk_data" as const,
    headers,
    rows,
    rowCount: rows.length,
  };
}

function fillData(rows: Record<string, string | number | null>[]) {
  const headers = [
    "Batch", "Order", "Material", "Pck Size", "Total Order Quantity",
  ];
  // Remap keys to match extractFillData expected column names
  const remapped = rows.map((r) => ({
    Batch: r["Bulk Order"] ?? null,
    Order: r["Fill Order"] ?? null,
    Material: r["Fill Material"] ?? null,
    "Pck Size": r["Pack Size"] ?? null,
    "Total Order Quantity": r["Fill Quantity"] ?? null,
  }));
  return {
    fileName: "fill_data.xlsx",
    type: "fill_data" as const,
    headers,
    rows: remapped,
    rowCount: remapped.length,
  };
}

function bomFile(type: "bulk_components" | "fill_components", rows: Record<string, string | number | null>[]) {
  const headers = [
    "Order", "Material", "Material Description", "Requirement Quantity",
    "Quantity Withdrawn", "Requirement Date", "Base Unit of Measure",
  ];
  return {
    fileName: `${type}.xlsx`,
    type,
    headers,
    rows,
    rowCount: rows.length,
  };
}

function sohReport(rows: Record<string, string | number | null>[]) {
  const headers = ["Material", "Material Description", "Unrestricted", "Base Unit of Measure"];
  return {
    fileName: "soh_report.xlsx",
    type: "soh" as const,
    headers,
    rows,
    rowCount: rows.length,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("Shortage calculation — Excel vs App comparison", () => {

  /*
   * SCENARIO 1: Single bulk order, single RM material, SOH is sufficient
   *
   * Excel calculation:
   *   Material K3179 | Required: 500 KG | SOH: 1000 KG | Short: 0
   *
   * Expected: No shortage, rmAvailable = true
   */
  it("Scenario 1: No shortage when SOH exceeds requirement", () => {
    const result = processFilesToBatches([
      bulkData([{
        Order: "60100001",
        "Basic Start Date": "2026-03-26",
        Material: "11088263-20L",
        "Material Description": "WALP FENCE JARRAH 20L",
        "Total Order Quantity": "4750",
      }]),
      bomFile("bulk_components", [{
        Order: "60100001",
        Material: "K3179",
        "Material Description": "TITANIUM DIOXIDE R-706",
        "Requirement Quantity": "500",
        "Quantity Withdrawn": "0",
        "Requirement Date": "2026-03-26",
        "Base Unit of Measure": "KG",
      }]),
      sohReport([{
        Material: "K3179",
        "Material Description": "TITANIUM DIOXIDE R-706",
        Unrestricted: "1000",
        "Base Unit of Measure": "KG",
      }]),
    ]);

    // No shortages should be generated
    expect(result.shortages).toHaveLength(0);
    expect(result.batches[0]?.rmAvailable).toBe(true);
    expect(result.batches[0]?.materialShortage).toBe(false);
  });

  /*
   * SCENARIO 2: Single order, single RM material, SOH insufficient
   *
   * Excel calculation:
   *   Material K3179 | Required: 1631.45 KG | SOH: 800 KG | Short: -831.45
   */
  it("Scenario 2: RM shortage when SOH < requirement", () => {
    const result = processFilesToBatches([
      bulkData([{
        Order: "60100002",
        "Basic Start Date": "2026-03-26",
        Material: "11088263-20L",
        "Material Description": "WALP FENCE JARRAH 20L",
        "Total Order Quantity": "4750",
      }]),
      bomFile("bulk_components", [{
        Order: "60100002",
        Material: "K3179",
        "Material Description": "TITANIUM DIOXIDE R-706",
        "Requirement Quantity": "1631.45",
        "Quantity Withdrawn": "0",
        "Requirement Date": "2026-03-26",
        "Base Unit of Measure": "KG",
      }]),
      sohReport([{
        Material: "K3179",
        "Material Description": "TITANIUM DIOXIDE R-706",
        Unrestricted: "800",
        "Base Unit of Measure": "KG",
      }]),
    ]);

    // Should have exactly 1 shortage record
    expect(result.shortages).toHaveLength(1);
    const shortage = result.shortages[0]!;
    expect(shortage.materialCode).toBe("K3179");
    expect(shortage.requiredQty).toBe(1631.45);
    expect(shortage.sohQty).toBe(800);
    expect(shortage.shortQty).toBe(-831.45); // negative = short
    expect(shortage.materialType).toBe("RM");
    expect(shortage.uom).toBe("KG");

    // Batch should flag RM shortage
    expect(result.batches[0]?.rmAvailable).toBe(false);
    expect(result.batches[0]?.materialShortage).toBe(true);
  });

  /*
   * SCENARIO 3: Two orders sharing the same RM material — cumulative drawdown
   *
   * Excel calculation (cumulative):
   *   SOH K3179 = 500 KG
   *   Order 60100003 (date: Mar 25) needs 300 KG → remaining SOH = 200
   *   Order 60100004 (date: Mar 26) needs 400 KG → short by 200
   *
   *   Aggregate: Required = 700, SOH = 500, Short = -200
   *
   *   Per-batch: Order 60100003 short = 0, Order 60100004 short = -200
   */
  it("Scenario 3: Cumulative drawdown — first order consumes SOH, second is short", () => {
    const result = processFilesToBatches([
      bulkData([
        {
          Order: "60100003",
          "Basic Start Date": "2026-03-25",
          Material: "11088263-20L",
          "Material Description": "WALP FENCE JARRAH 20L",
          "Total Order Quantity": "3000",
        },
        {
          Order: "60100004",
          "Basic Start Date": "2026-03-26",
          Material: "11088264-10L",
          "Material Description": "WALP FENCE MERBAU 10L",
          "Total Order Quantity": "2000",
        },
      ]),
      bomFile("bulk_components", [
        {
          Order: "60100003",
          Material: "K3179",
          "Material Description": "TITANIUM DIOXIDE R-706",
          "Requirement Quantity": "300",
          "Quantity Withdrawn": "0",
          "Requirement Date": "2026-03-25",
          "Base Unit of Measure": "KG",
        },
        {
          Order: "60100004",
          Material: "K3179",
          "Material Description": "TITANIUM DIOXIDE R-706",
          "Requirement Quantity": "400",
          "Quantity Withdrawn": "0",
          "Requirement Date": "2026-03-26",
          "Base Unit of Measure": "KG",
        },
      ]),
      sohReport([{
        Material: "K3179",
        "Material Description": "TITANIUM DIOXIDE R-706",
        Unrestricted: "500",
        "Base Unit of Measure": "KG",
      }]),
    ]);

    // Aggregate shortage: total required 700, SOH 500, short 200
    expect(result.shortages).toHaveLength(1);
    const shortage = result.shortages[0]!;
    expect(shortage.materialCode).toBe("K3179");
    expect(shortage.requiredQty).toBe(700);
    expect(shortage.sohQty).toBe(500);
    expect(shortage.shortQty).toBe(-200);

    // First batch (order 60100003) should NOT be flagged — it got enough SOH
    const batch1 = result.batches.find((b) => b.sapOrder === "60100003")!;
    expect(batch1.rmAvailable).toBe(true);
    expect(batch1.materialShortage).toBe(false);

    // Second batch (order 60100004) SHOULD be flagged — SOH exhausted
    const batch2 = result.batches.find((b) => b.sapOrder === "60100004")!;
    expect(batch2.rmAvailable).toBe(false);
    expect(batch2.materialShortage).toBe(true);

    // Per-batch shortage detail for the second batch
    const batch2Details = result.batchShortageDetails.get("60100004");
    expect(batch2Details).toBeDefined();
    expect(batch2Details).toHaveLength(1);
    expect(batch2Details![0]!.materialCode).toBe("K3179");
    expect(batch2Details![0]!.requiredQty).toBe(400);
    expect(batch2Details![0]!.shortQty).toBe(-200);

    // First batch should have no shortage details
    expect(result.batchShortageDetails.has("60100003")).toBe(false);
  });

  /*
   * SCENARIO 4: Packaging shortage via fill order
   *
   * Bulk order 60100005 links to fill order 60200005.
   * Fill order BOM has a label material (LABJARR20L) that's short.
   *
   * Excel calculation:
   *   LABJARR20L | Required: 500 EA | SOH: 100 EA | Short: -400
   */
  it("Scenario 4: Packaging shortage detected via fill order BOM", () => {
    const result = processFilesToBatches([
      bulkData([{
        Order: "60100005",
        "Basic Start Date": "2026-03-26",
        Material: "11088263-20L",
        "Material Description": "WALP FENCE JARRAH 20L",
        "Total Order Quantity": "4750",
      }]),
      fillData([{
        "Bulk Order": "60100005",
        "Fill Order": "60200005",
        "Fill Material": "11088263-20L",
        "Pack Size": "20L",
        "Fill Quantity": "500",
      }]),
      bomFile("fill_components", [{
        Order: "60200005",
        Material: "LABJARR20L",
        "Material Description": "LABEL JARRAH 20L",
        "Requirement Quantity": "500",
        "Quantity Withdrawn": "0",
        "Requirement Date": "2026-03-26",
        "Base Unit of Measure": "EA",
      }]),
      sohReport([{
        Material: "LABJARR20L",
        "Material Description": "LABEL JARRAH 20L",
        Unrestricted: "100",
        "Base Unit of Measure": "EA",
      }]),
    ]);

    // Should detect the packaging shortage
    expect(result.shortages).toHaveLength(1);
    const shortage = result.shortages[0]!;
    expect(shortage.materialCode).toBe("LABJARR20L");
    expect(shortage.materialType).toBe("PKG");
    expect(shortage.requiredQty).toBe(500);
    expect(shortage.sohQty).toBe(100);
    expect(shortage.shortQty).toBe(-400);
    expect(shortage.uom).toBe("EA");

    // Batch should flag packaging shortage
    const batch = result.batches[0]!;
    expect(batch.packagingAvailable).toBe(false);
    expect(batch.materialShortage).toBe(true);
  });

  /*
   * SCENARIO 5: Combined RM + Packaging shortages
   *
   * Bulk order has an RM shortage (K3179), and its fill order has a packaging
   * shortage (LABJARR20L).
   *
   * Excel calculation:
   *   K3179      | Required: 600 KG | SOH: 200 KG | Short: -400
   *   LABJARR20L | Required: 300 EA | SOH: 50 EA  | Short: -250
   */
  it("Scenario 5: Both RM and packaging shortages on same batch", () => {
    const result = processFilesToBatches([
      bulkData([{
        Order: "60100006",
        "Basic Start Date": "2026-03-26",
        Material: "11088263-20L",
        "Material Description": "WALP FENCE JARRAH 20L",
        "Total Order Quantity": "4750",
      }]),
      fillData([{
        "Bulk Order": "60100006",
        "Fill Order": "60200006",
        "Fill Material": "11088263-20L",
        "Pack Size": "20L",
        "Fill Quantity": "300",
      }]),
      bomFile("bulk_components", [{
        Order: "60100006",
        Material: "K3179",
        "Material Description": "TITANIUM DIOXIDE R-706",
        "Requirement Quantity": "600",
        "Quantity Withdrawn": "0",
        "Requirement Date": "2026-03-26",
        "Base Unit of Measure": "KG",
      }]),
      bomFile("fill_components", [{
        Order: "60200006",
        Material: "LABJARR20L",
        "Material Description": "LABEL JARRAH 20L",
        "Requirement Quantity": "300",
        "Quantity Withdrawn": "0",
        "Requirement Date": "2026-03-26",
        "Base Unit of Measure": "EA",
      }]),
      sohReport([
        {
          Material: "K3179",
          "Material Description": "TITANIUM DIOXIDE R-706",
          Unrestricted: "200",
          "Base Unit of Measure": "KG",
        },
        {
          Material: "LABJARR20L",
          "Material Description": "LABEL JARRAH 20L",
          Unrestricted: "50",
          "Base Unit of Measure": "EA",
        },
      ]),
    ]);

    // Should have 2 shortage records
    expect(result.shortages).toHaveLength(2);

    const rmShortage = result.shortages.find((s) => s.materialCode === "K3179")!;
    expect(rmShortage.materialType).toBe("RM");
    expect(rmShortage.requiredQty).toBe(600);
    expect(rmShortage.sohQty).toBe(200);
    expect(rmShortage.shortQty).toBe(-400);

    const pkgShortage = result.shortages.find((s) => s.materialCode === "LABJARR20L")!;
    expect(pkgShortage.materialType).toBe("PKG");
    expect(pkgShortage.requiredQty).toBe(300);
    expect(pkgShortage.sohQty).toBe(50);
    expect(pkgShortage.shortQty).toBe(-250);

    // Batch flags
    const batch = result.batches[0]!;
    expect(batch.rmAvailable).toBe(false);
    expect(batch.packagingAvailable).toBe(false);
    expect(batch.materialShortage).toBe(true);
  });

  /*
   * SCENARIO 6: Multiple BOM lines for same material on same order
   *
   * Order 60100007 has TWO BOM lines for K3179 (common in SAP when there are
   * sub-operations). They should be aggregated before comparing to SOH.
   *
   * Excel calculation:
   *   K3179 | Required: 200 + 300 = 500 KG | SOH: 400 KG | Short: -100
   */
  it("Scenario 6: Multiple BOM lines for same material aggregated per order", () => {
    const result = processFilesToBatches([
      bulkData([{
        Order: "60100007",
        "Basic Start Date": "2026-03-26",
        Material: "11088263-20L",
        "Material Description": "WALP FENCE JARRAH 20L",
        "Total Order Quantity": "4750",
      }]),
      bomFile("bulk_components", [
        {
          Order: "60100007",
          Material: "K3179",
          "Material Description": "TITANIUM DIOXIDE R-706",
          "Requirement Quantity": "200",
          "Quantity Withdrawn": "0",
          "Requirement Date": "2026-03-26",
          "Base Unit of Measure": "KG",
        },
        {
          Order: "60100007",
          Material: "K3179",
          "Material Description": "TITANIUM DIOXIDE R-706",
          "Requirement Quantity": "300",
          "Quantity Withdrawn": "0",
          "Requirement Date": "2026-03-26",
          "Base Unit of Measure": "KG",
        },
      ]),
      sohReport([{
        Material: "K3179",
        "Material Description": "TITANIUM DIOXIDE R-706",
        Unrestricted: "400",
        "Base Unit of Measure": "KG",
      }]),
    ]);

    expect(result.shortages).toHaveLength(1);
    const shortage = result.shortages[0]!;
    expect(shortage.materialCode).toBe("K3179");
    expect(shortage.requiredQty).toBe(500); // 200 + 300 aggregated
    expect(shortage.sohQty).toBe(400);
    expect(shortage.shortQty).toBe(-100);
  });

  /*
   * SCENARIO 7: Three orders consuming SOH progressively
   *
   * This verifies the cumulative drawdown across multiple orders:
   *   SOH K3179 = 1000 KG
   *   Order A (Mar 24): needs 400 → remaining 600, short = 0
   *   Order B (Mar 25): needs 500 → remaining 100, short = 0
   *   Order C (Mar 26): needs 300 → remaining 0, short = 200
   *
   * Aggregate: Required = 1200, SOH = 1000, Short = -200
   */
  it("Scenario 7: Three orders — progressive SOH drawdown", () => {
    const result = processFilesToBatches([
      bulkData([
        {
          Order: "60100008",
          "Basic Start Date": "2026-03-24",
          Material: "11088263-20L",
          "Material Description": "WALP FENCE JARRAH 20L",
          "Total Order Quantity": "3000",
        },
        {
          Order: "60100009",
          "Basic Start Date": "2026-03-25",
          Material: "11088264-10L",
          "Material Description": "WALP FENCE MERBAU 10L",
          "Total Order Quantity": "2000",
        },
        {
          Order: "60100010",
          "Basic Start Date": "2026-03-26",
          Material: "11088265-4L",
          "Material Description": "WALP FENCE PAPERBARK 4L",
          "Total Order Quantity": "1500",
        },
      ]),
      bomFile("bulk_components", [
        {
          Order: "60100008",
          Material: "K3179",
          "Material Description": "TITANIUM DIOXIDE R-706",
          "Requirement Quantity": "400",
          "Quantity Withdrawn": "0",
          "Requirement Date": "2026-03-24",
          "Base Unit of Measure": "KG",
        },
        {
          Order: "60100009",
          Material: "K3179",
          "Material Description": "TITANIUM DIOXIDE R-706",
          "Requirement Quantity": "500",
          "Quantity Withdrawn": "0",
          "Requirement Date": "2026-03-25",
          "Base Unit of Measure": "KG",
        },
        {
          Order: "60100010",
          Material: "K3179",
          "Material Description": "TITANIUM DIOXIDE R-706",
          "Requirement Quantity": "300",
          "Quantity Withdrawn": "0",
          "Requirement Date": "2026-03-26",
          "Base Unit of Measure": "KG",
        },
      ]),
      sohReport([{
        Material: "K3179",
        "Material Description": "TITANIUM DIOXIDE R-706",
        Unrestricted: "1000",
        "Base Unit of Measure": "KG",
      }]),
    ]);

    // Aggregate: only the last order is short
    expect(result.shortages).toHaveLength(1);
    const shortage = result.shortages[0]!;
    expect(shortage.requiredQty).toBe(1200);
    expect(shortage.sohQty).toBe(1000);
    expect(shortage.shortQty).toBe(-200);

    // First two batches OK, third is short
    expect(result.batches.find((b) => b.sapOrder === "60100008")!.rmAvailable).toBe(true);
    expect(result.batches.find((b) => b.sapOrder === "60100009")!.rmAvailable).toBe(true);
    expect(result.batches.find((b) => b.sapOrder === "60100010")!.rmAvailable).toBe(false);

    // Per-batch detail: only order 60100010 has a shortage
    expect(result.batchShortageDetails.has("60100008")).toBe(false);
    expect(result.batchShortageDetails.has("60100009")).toBe(false);
    const details = result.batchShortageDetails.get("60100010")!;
    expect(details).toHaveLength(1);
    expect(details[0]!.requiredQty).toBe(300);
    expect(details[0]!.shortQty).toBe(-200);
  });

  /*
   * SCENARIO 8: Material with zero SOH (not in SOH report)
   *
   * If a material appears in BOM but NOT in the SOH report at all,
   * the entire requirement is short.
   *
   * Excel calculation:
   *   K9999 | Required: 250 KG | SOH: 0 KG | Short: -250
   */
  it("Scenario 8: Material missing from SOH report — entire qty is short", () => {
    const result = processFilesToBatches([
      bulkData([{
        Order: "60100011",
        "Basic Start Date": "2026-03-26",
        Material: "11088263-20L",
        "Material Description": "WALP FENCE JARRAH 20L",
        "Total Order Quantity": "4750",
      }]),
      bomFile("bulk_components", [{
        Order: "60100011",
        Material: "K9999",
        "Material Description": "SPECIAL ADDITIVE XYZ",
        "Requirement Quantity": "250",
        "Quantity Withdrawn": "0",
        "Requirement Date": "2026-03-26",
        "Base Unit of Measure": "KG",
      }]),
      // No SOH entry for K9999 — stock is zero
      sohReport([]),
    ]);

    expect(result.shortages).toHaveLength(1);
    const shortage = result.shortages[0]!;
    expect(shortage.materialCode).toBe("K9999");
    expect(shortage.requiredQty).toBe(250);
    expect(shortage.sohQty).toBe(0);
    expect(shortage.shortQty).toBe(-250);
  });

  /*
   * SCENARIO 9: Multiple materials short on the same order
   *
   * Excel calculation:
   *   K3179  | Required: 400 KG | SOH: 100 KG | Short: -300
   *   K5220  | Required: 200 KG | SOH: 50 KG  | Short: -150
   */
  it("Scenario 9: Multiple materials short on same order", () => {
    const result = processFilesToBatches([
      bulkData([{
        Order: "60100012",
        "Basic Start Date": "2026-03-26",
        Material: "11088263-20L",
        "Material Description": "WALP FENCE JARRAH 20L",
        "Total Order Quantity": "4750",
      }]),
      bomFile("bulk_components", [
        {
          Order: "60100012",
          Material: "K3179",
          "Material Description": "TITANIUM DIOXIDE R-706",
          "Requirement Quantity": "400",
          "Quantity Withdrawn": "0",
          "Requirement Date": "2026-03-26",
          "Base Unit of Measure": "KG",
        },
        {
          Order: "60100012",
          Material: "K5220",
          "Material Description": "YELLOW OXIDE 920",
          "Requirement Quantity": "200",
          "Quantity Withdrawn": "0",
          "Requirement Date": "2026-03-26",
          "Base Unit of Measure": "KG",
        },
      ]),
      sohReport([
        {
          Material: "K3179",
          "Material Description": "TITANIUM DIOXIDE R-706",
          Unrestricted: "100",
          "Base Unit of Measure": "KG",
        },
        {
          Material: "K5220",
          "Material Description": "YELLOW OXIDE 920",
          Unrestricted: "50",
          "Base Unit of Measure": "KG",
        },
      ]),
    ]);

    expect(result.shortages).toHaveLength(2);

    const s1 = result.shortages.find((s) => s.materialCode === "K3179")!;
    expect(s1.requiredQty).toBe(400);
    expect(s1.sohQty).toBe(100);
    expect(s1.shortQty).toBe(-300);

    const s2 = result.shortages.find((s) => s.materialCode === "K5220")!;
    expect(s2.requiredQty).toBe(200);
    expect(s2.sohQty).toBe(50);
    expect(s2.shortQty).toBe(-150);

    // Both materials cause batch shortage
    const batchDetails = result.batchShortageDetails.get("60100012")!;
    expect(batchDetails).toHaveLength(2);
  });

  /*
   * SCENARIO 10: UOM from BOM file used correctly
   *
   * Verifies that UOM comes from the SOH report (preferred) or BOM file,
   * not from the old quantity > 100 heuristic.
   */
  it("Scenario 10: UOM sourced from SOH/BOM file, not guessed", () => {
    const result = processFilesToBatches([
      bulkData([{
        Order: "60100013",
        "Basic Start Date": "2026-03-26",
        Material: "11088263-20L",
        "Material Description": "WALP FENCE JARRAH 20L",
        "Total Order Quantity": "4750",
      }]),
      bomFile("bulk_components", [{
        Order: "60100013",
        Material: "K8888",
        "Material Description": "SMALL QTY CATALYST",
        "Requirement Quantity": "5", // Small qty — old heuristic would say "EA"
        "Quantity Withdrawn": "0",
        "Requirement Date": "2026-03-26",
        "Base Unit of Measure": "L", // Actual UOM is litres
      }]),
      sohReport([{
        Material: "K8888",
        "Material Description": "SMALL QTY CATALYST",
        Unrestricted: "2",
        "Base Unit of Measure": "L",
      }]),
    ]);

    expect(result.shortages).toHaveLength(1);
    expect(result.shortages[0]!.uom).toBe("L"); // NOT "EA" from old heuristic
  });
});
