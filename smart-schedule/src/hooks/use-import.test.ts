import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import React from "react";
import { useImport, processFilesToBatches } from "./use-import";
import { QueryClientTestProvider, createTestQueryClient } from "@/test/query-client";

const { mockParseExcelFile, mockFrom } = vi.hoisted(() => ({
  mockParseExcelFile: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock("@/lib/utils/excel-parser", () => ({
  parseExcelFile: mockParseExcelFile,
  excelDateToISO: (value: unknown) => {
    if (typeof value === "string") return value;
    // Handle Excel serial dates (e.g. 45634 → 2024-12-08)
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
  supabase: {
    from: mockFrom,
  },
}));

describe("use-import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("processes bulk file rows into import batches", () => {
    const result = processFilesToBatches([
      {
        fileName: "bulk.xlsx",
        type: "bulk_data",
        headers: ["Order", "Material", "Total Order Qty", "Colour Group"],
        rows: [{ Order: "1001", Material: "MAT-20L", "Total Order Qty": "12", "Colour Group": "Blue" }],
        rowCount: 1,
      },
    ]);

    expect(result.batches).toHaveLength(1);
    expect(result.batches[0]?.sapOrder).toBe("1001");
    expect(result.batches[0]?.batchVolume).toBe(12);
    expect(result.batches[0]?.packSize).toBe("20L");
    expect(result.batches[0]?.sapMixerResource).toBeNull();
    expect(result.batches[0]?.sapDisperser1).toBeNull();
    expect(result.batches[0]?.sapDisperser2).toBeNull();
    expect(result.missingDates).toBe(1);
  });

  it("parses SAP resource columns from bulk data export", () => {
    const result = processFilesToBatches([
      {
        fileName: "bulk.xlsx",
        type: "bulk_data",
        headers: [
          "Order", "Basic Start Date", "Material", "Total Order Quantity",
          "Material Description", "Dispersion 1 Resource", "PRe Mix Count",
          "Dispersion 2 Resource", "Mixer Resource", "IPT", "ColGrp",
          "Fill Order", "Fill Quantity",
        ],
        rows: [{
          Order: "10126991",
          "Basic Start Date": "2025-12-08",
          Material: "11088263-B",
          "Total Order Quantity": "4750",
          "Material Description": "WALP FENCE FINISH JARRAH",
          "Dispersion 1 Resource": "HSD2",
          "PRe Mix Count": "1",
          "Dispersion 2 Resource": "ABI",
          "Mixer Resource": "MIXER42",
          IPT: "0",
          ColGrp: "CGRED",
          "Fill Order": "12088730",
          "Fill Quantity": "480",
        }],
        rowCount: 1,
      },
    ]);

    expect(result.batches).toHaveLength(1);
    const batch = result.batches[0]!;
    expect(batch.sapOrder).toBe("10126991");
    expect(batch.planDate).toBe("2025-12-08");
    expect(batch.batchVolume).toBe(4750);
    expect(batch.sapMixerResource).toBe("MIXER42");
    expect(batch.sapDisperser1).toBe("HSD2");
    expect(batch.sapDisperser2).toBe("ABI");
    expect(batch.sapPreMixCount).toBe(1);
    expect(batch.sapIpt).toBe(0);
    expect(batch.sapFillOrder).toBe("12088730");
    expect(batch.sapFillQuantity).toBe(480);
    expect(result.missingDates).toBe(0);
  });

  it("handles Excel serial date numbers (not stringified)", () => {
    // Excel serial 45634 = 2024-12-08. SheetJS returns dates as numbers.
    const result = processFilesToBatches([
      {
        fileName: "bulk.xlsx",
        type: "bulk_data",
        headers: ["Order", "Basic Start Date", "Material", "Total Order Quantity"],
        rows: [{
          Order: "5001",
          "Basic Start Date": 45634, // Excel serial number (NOT a string)
          Material: "MAT-A",
          "Total Order Quantity": 1000,
        }],
        rowCount: 1,
      },
    ]);

    expect(result.batches).toHaveLength(1);
    // Should parse the serial number, NOT default to today
    expect(result.batches[0]!.planDate).toBe("2024-12-08");
    expect(result.missingDates).toBe(0);
  });

  it("adds files and derives parsed file metadata and batches", async () => {
    mockParseExcelFile.mockResolvedValueOnce([
      {
        "Bulk Order": "2001",
        Material: "RM-5L",
        "Order Quantity": 5,
      },
    ]);

    const client = createTestQueryClient();
    const { result } = renderHook(() => useImport(), {
      wrapper: ({ children }) =>
        React.createElement(QueryClientTestProvider, { client }, children),
    });

    await act(async () => {
      await result.current.addFiles([new File(["x"], "bulk-file.xlsx")]);
    });

    expect(result.current.files).toHaveLength(1);
    expect(result.current.files[0]?.type).toBe("bulk_data");
    expect(result.current.batches).toHaveLength(1);
    expect(result.current.batches[0]?.sapOrder).toBe("2001");

    act(() => {
      result.current.clearFiles();
    });

    expect(result.current.files).toHaveLength(0);
    expect(result.current.batches).toHaveLength(0);
  });

  it("imports in replace mode and clears staged data on success", async () => {
    mockParseExcelFile.mockResolvedValueOnce([
      {
        "Bulk Order": "3001",
        Material: "MAT-1L",
        "Order Quantity": 1,
      },
    ]);

    const deleteEq = vi.fn().mockResolvedValue({ error: null });
    const deleteMock = vi.fn(() => ({ eq: deleteEq }));
    const insertMock = vi.fn().mockResolvedValue({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "batches") {
        return {
          delete: deleteMock,
          insert: insertMock,
        };
      }
      return {};
    });

    const client = createTestQueryClient();
    const { result } = renderHook(() => useImport(), {
      wrapper: ({ children }) =>
        React.createElement(QueryClientTestProvider, { client }, children),
    });

    await act(async () => {
      await result.current.addFiles([new File(["x"], "bulk-file.xlsx")]);
    });

    act(() => {
      result.current.importBatches({ data: result.current.batches, mode: "replace" });
    });

    await waitFor(() => {
      expect(result.current.isImporting).toBe(false);
    });

    expect(deleteEq).toHaveBeenCalledWith("site_id", "site-1");
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(result.current.files).toHaveLength(0);
    expect(result.current.batches).toHaveLength(0);
  });
});
