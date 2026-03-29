import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import { useResources } from "./use-resources";
import { parseExcelFile, excelDateToISO, type ParsedRow } from "@/lib/utils/excel-parser";
import { assignBatchesToResources, resolveConflictsWithSubstitutions } from "@/lib/utils/resource-assignment";
import { useSubstitutionRules } from "./use-rules";

/** Recognised SAP file types */
export type SapFileType =
  | "bulk_data"
  | "fill_data"
  | "coois"
  | "zp40"
  | "zw04"
  | "mb52"
  | "soh"
  | "fill_components"
  | "bulk_components"
  | "ibp_forecast"
  | "unknown";

export interface ParsedFile {
  fileName: string;
  type: SapFileType;
  headers: string[];
  rows: ParsedRow[];
  rowCount: number;
}

export interface ImportBatch {
  sapOrder: string;
  materialCode: string | null;
  materialDescription: string | null;
  bulkCode: string | null;
  planDate: string | null;
  batchVolume: number | null;
  sapColorGroup: string | null;
  packSize: string | null;
  rmAvailable: boolean;
  packagingAvailable: boolean;
  stockCover: number | null;
  safetyStock: number | null;
  poDate: string | null;
  poQuantity: number | null;
  forecast: number | null;
  materialShortage: boolean;
  sapMixerResource: string | null;
  sapDisperser1: string | null;
  sapDisperser2: string | null;
  sapPreMixCount: number | null;
  sapPreMixCount2: number | null;
  sapIpt: number | null;
  sapFillOrder: string | null;
  sapFillQuantity: number | null;
  sapFillMaterial: string | null;
  sapFillPackSize: string | null;
  /** All fill orders linked to this bulk batch (used for DB insert) */
  sapFillOrders: FillRecord[];
  /** "X" in Mat.Grping column — material requires vetting */
  matGrping: boolean;
  /** "X" in Recipient column — material has been vetted */
  recipient: boolean;
}

export type ImportMode = "replace" | "update" | "merge" | "soh_update";

function detectFileType(headers: string[]): SapFileType {
  const set = new Set(headers.map((h) => h.toLowerCase().trim()));
  const arr = [...set];

  // Bulk Data (SAP production order export with mixer/dispersion columns)
  if (
    set.has("dispersion 1 resource") ||
    set.has("mixer resource") ||
    (set.has("ipt") && set.has("colgrp"))
  )
    return "bulk_data";

  // COOIS – generic production order list (no mixer columns) — before ZP40/ZW04
  if (set.has("order") && set.has("material number") && set.has("basic start date"))
    return "coois";

  // ZP40 – Planning / Stock Coverage report
  if (set.has("planning material") || set.has("stock cover") || set.has("available stock"))
    return "zp40";

  // ZW04 – Purchase Orders
  if (set.has("purchasing document") || set.has("po.deliv.dt"))
    return "zw04";

  // Requirements / BOM components report (combined bulk + fill BOM lines)
  if (
    arr.some((h) => h.includes("requirement quantity")) &&
    arr.some((h) => h.includes("requirement date"))
  )
    return "fill_components";

  // SOH Report — has Unrestricted + Base Unit of Measure but NOT plant columns
  // (distinguishes from MB52 which has Plant/Plnt/Name 1)
  if (
    set.has("unrestricted") &&
    arr.some((h) => h.includes("base unit")) &&
    !set.has("plnt") &&
    !set.has("plant") &&
    !set.has("name 1")
  )
    return "soh";

  // Fill Data (filled-product orders with pack size / batch columns)
  if (
    set.has("pck size") ||
    (set.has("batch") && arr.some((h) => h.includes("total order quantity")))
  )
    return "fill_data";

  // MB52 – Plant-level stock (has plant column)
  if (
    (set.has("unrestricted") || arr.some((h) => h.includes("unrestricted"))) &&
    (set.has("plnt") || set.has("plant") || set.has("name 1"))
  )
    return "mb52";

  // IBP Sales & Forecast (QF00) — has product/location/time period columns
  if (
    set.has("product id") &&
    set.has("time periods") &&
    (set.has("actuals qty") || set.has("demand released"))
  )
    return "ibp_forecast";

  // Bulk Components BOM
  if (
    set.has("item component list") ||
    set.has("pegged requirement") ||
    (set.has("order") && arr.some((h) => h.includes("requirement quantity")))
  )
    return "bulk_components";

  // Fallback: if it has order + material columns, treat as bulk
  if (
    (set.has("order") || arr.some((h) => h.includes("order"))) &&
    (set.has("material") || arr.some((h) => h.includes("material")))
  )
    return "bulk_data";

  return "unknown";
}

function extractPackSize(materialCode: string | null): string | null {
  if (!materialCode) return null;
  const match = materialCode.match(/[-_](\d+(?:\.\d+)?[LMlm][Ll]?)$/);
  return match ? match[1]!.toUpperCase() : null;
}

function findColumn(headers: string[], ...keywords: string[]): string | null {
  for (const kw of keywords) {
    // Prefer exact match (case-insensitive) to avoid short keywords matching
    // unrelated headers (e.g. "ipt" matching "Material Description")
    const exact = headers.find((h) => h.toLowerCase() === kw.toLowerCase());
    if (exact) return exact;
    const match = headers.find((h) =>
      h.toLowerCase().includes(kw.toLowerCase()),
    );
    if (match) return match;
  }
  return null;
}

/** Returns the raw cell value (preserving number type for dates/serials) */
function rowRawValue(row: ParsedRow, headers: string[], ...keywords: string[]): string | number | null {
  const col = findColumn(headers, ...keywords);
  if (!col) return null;
  const val = row[col];
  if (val == null || val === "") return null;
  return val;
}

function rowValue(row: ParsedRow, headers: string[], ...keywords: string[]): string | null {
  const col = findColumn(headers, ...keywords);
  if (!col) return null;
  const val = row[col];
  if (val == null || val === "") return null;
  return String(val);
}

function rowNumeric(row: ParsedRow, headers: string[], ...keywords: string[]): number | null {
  const col = findColumn(headers, ...keywords);
  if (!col) return null;
  const val = row[col];
  if (val == null || val === "") return null;
  const n = typeof val === "number" ? val : parseFloat(String(val));
  return isNaN(n) ? null : n;
}

/**
 * Reads a numeric value from the column immediately following anchorKeyword.
 * Used to read the second "Pre Mix Count" column that appears after "Dispersion 2 Resource",
 * since both premix count columns may share the same header name.
 */
function rowNumericAfter(row: ParsedRow, headers: string[], anchorKeyword: string): number | null {
  const anchorCol = findColumn(headers, anchorKeyword);
  if (!anchorCol) return null;
  const anchorIdx = headers.indexOf(anchorCol);
  if (anchorIdx < 0 || anchorIdx + 1 >= headers.length) return null;
  const nextCol = headers[anchorIdx + 1];
  if (!nextCol) return null;
  const val = row[nextCol];
  if (val == null || val === "") return null;
  const n = typeof val === "number" ? val : parseFloat(String(val));
  return isNaN(n) ? null : n;
}

/** ZP40 coverage record keyed by material code */
interface Zp40Record {
  stockCover: number | null;
  forecast: number | null;
  availableStock: number | null;
  safetyStock: number | null;
}

/** ZW04 purchase order record keyed by material code */
interface Zw04Record {
  poDate: string | null;
  poQuantity: number | null;
}

/** MB52 plant-level stock record keyed by material code */
interface Mb52Record {
  /** Unrestricted stock from MB52, or safety stock from ZP40 fallback */
  safetyStock: number | null;
  description?: string;
  uom?: string;
}

/** Fill Data record keyed by batch/order number */
interface FillRecord {
  fillOrder: string;
  fillMaterial: string | null;
  packSize: string | null;
  fillQuantity: number | null;
  /** BOM component material codes (e.g. ANOPR15X, LOPBOCAPF) */
  components: string[];
}

/** Requirements record for per-order shortage calculation */
interface RequirementEntry {
  order: string;
  material: string;
  description: string;
  reqQty: number;
  qtyWithdrawn: number;
  netQty: number;
  reqDate: string;
  uom: string;
}

function extractZp40Data(files: ParsedFile[]): Map<string, Zp40Record> {
  const map = new Map<string, Zp40Record>();
  const zp40File = files.find((f) => f.type === "zp40");
  if (!zp40File) return map;

  const { headers, rows } = zp40File;
  for (const row of rows) {
    // ZP40 has two material columns: "Planning material" (bulk) and "Material" (fill)
    // Key by fill material, but also index by planning material (bulk code) as fallback
    const planningMat = rowValue(row, headers, "planning material", "planning mat");
    const material = rowValue(row, headers, "material") ?? planningMat;
    if (!material) continue;

    const stockCover = rowNumeric(row, headers, "stock cover");
    const forecast = rowNumeric(row, headers, "current month forecast", "current month");
    const availableStock = rowNumeric(row, headers, "available stock");
    const safetyStock = rowNumeric(row, headers, "safety stock");

    if (!map.has(material)) {
      map.set(material, { stockCover, forecast, availableStock, safetyStock });
    }
    // Also index by planning material (bulk code) so bulk-level lookup works
    if (planningMat && planningMat !== material && !map.has(planningMat)) {
      map.set(planningMat, { stockCover, forecast, availableStock, safetyStock });
    }
  }
  return map;
}

function extractZw04Data(files: ParsedFile[]): Map<string, Zw04Record> {
  const map = new Map<string, Zw04Record>();
  const zw04File = files.find((f) => f.type === "zw04");
  if (!zw04File) return map;

  const { headers, rows } = zw04File;
  for (const row of rows) {
    const material = rowValue(row, headers, "material");
    if (!material) continue;

    // ZW04 actual column names: "PO.Deliv.Dt" for delivery date, "Remain.Qty" for open qty
    const dateRaw = rowRawValue(row, headers, "po.deliv.dt", "delivery date", "del. date");
    const poDate = excelDateToISO(dateRaw);
    const poQuantity = rowNumeric(row, headers, "remain.qty", "remain. qty", "remaining", "order quantity");

    const existing = map.get(material);
    // Keep the earliest PO date for each material
    if (!existing || (poDate && (!existing.poDate || poDate < existing.poDate))) {
      map.set(material, { poDate, poQuantity });
    }
  }
  return map;
}

function extractMb52Data(files: ParsedFile[]): Map<string, Mb52Record> {
  const map = new Map<string, Mb52Record>();
  const mb52File = files.find((f) => f.type === "mb52");
  if (!mb52File) return map;

  const { headers, rows } = mb52File;
  for (const row of rows) {
    const material = rowValue(row, headers, "material");
    if (!material) continue;

    // MB52 "Unrestricted" column = available plant stock (not safety stock)
    const unrestricted = rowNumeric(row, headers, "unrestricted");
    const description = rowValue(row, headers, "material description", "description") ?? "";
    const uom = rowValue(row, headers, "base unit of measure", "base unit", "buom", "uom") ?? "KG";

    // Accumulate across plants for the same material
    const existing = map.get(material);
    if (existing) {
      existing.safetyStock = (existing.safetyStock ?? 0) + (unrestricted ?? 0);
    } else {
      map.set(material, { safetyStock: unrestricted, description, uom });
    }
  }
  return map;
}

/* ------------------------------------------------------------------ */
/*  Fill Data extraction — links fill orders to bulk orders             */
/* ------------------------------------------------------------------ */

function extractFillData(files: ParsedFile[]): Map<string, FillRecord[]> {
  const map = new Map<string, FillRecord[]>();
  const fillFile = files.find((f) => f.type === "fill_data");
  if (!fillFile) return map;

  const { headers, rows } = fillFile;
  for (const row of rows) {
    // Fill Data links to Bulk Data via the "Batch" column (= bulk order number)
    const batchOrder = rowValue(row, headers, "batch", "bulk order");
    if (!batchOrder) continue;

    const fillOrder = rowValue(row, headers, "order") ?? "";
    const fillMaterial = rowValue(row, headers, "material") ?? null;
    const packSize = rowValue(row, headers, "pck size", "pack size") ?? null;
    const fillQuantity = rowNumeric(row, headers, "total order quantity", "order quantity") ?? null;

    // Accumulate all fill orders per bulk batch, dedup by fill order number
    const existing = map.get(batchOrder) ?? [];
    if (!fillOrder || !existing.some((e) => e.fillOrder === fillOrder)) {
      existing.push({ fillOrder, fillMaterial, packSize, fillQuantity, components: [] });
    }
    map.set(batchOrder, existing);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/*  Requirements extraction — BOM components per order                  */
/* ------------------------------------------------------------------ */

function extractRequirements(files: ParsedFile[]): {
  byOrder: Map<string, RequirementEntry[]>;
  byMaterial: Map<string, RequirementEntry[]>;
} {
  const byOrder = new Map<string, RequirementEntry[]>();
  const byMaterial = new Map<string, RequirementEntry[]>();

  // Check both fill_components and bulk_components file types
  const reqFiles = files.filter(
    (f) => f.type === "fill_components" || f.type === "bulk_components",
  );
  if (reqFiles.length === 0) return { byOrder, byMaterial };

  // Deduplicate exact duplicate rows (same order, material, qty, withdrawn,
  // date) — these inflate requirements and create false shortages. Rows with
  // different quantities for the same order+material are legitimate BOM lines.
  const seen = new Set<string>();

  for (const reqFile of reqFiles) {
    const { headers, rows } = reqFile;
    for (const row of rows) {
      const order = rowValue(row, headers, "order");
      const material = rowValue(row, headers, "material");
      if (!order || !material) continue;

      const reqQty = rowNumeric(row, headers, "requirement quantity") ?? 0;
      const qtyWithdrawn = rowNumeric(row, headers, "quantity withdrawn") ?? 0;

      // Exact-row dedup: order + material + qty + withdrawn
      const dedupeKey = `${order}|${material}|${reqQty}|${qtyWithdrawn}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      // Net requirement = total required minus what's already been physically
      // withdrawn from the warehouse. SOH reflects current stock AFTER
      // withdrawals, so we must subtract withdrawn to avoid double-counting.
      const netQty = reqQty - qtyWithdrawn;

      const dateRaw = rowRawValue(row, headers, "requirement date");
      const reqDate = excelDateToISO(dateRaw) ?? "";
      const description = rowValue(row, headers, "material description", "description") ?? "";
      const uom = rowValue(row, headers, "base unit of measure", "base unit", "buom", "uom", "unit") ?? "";

      const entry: RequirementEntry = { order, material, description, reqQty, qtyWithdrawn, netQty, reqDate, uom };

      if (!byOrder.has(order)) byOrder.set(order, []);
      byOrder.get(order)!.push(entry);

      if (!byMaterial.has(material)) byMaterial.set(material, []);
      byMaterial.get(material)!.push(entry);
    }
  }
  return { byOrder, byMaterial };
}

/* ------------------------------------------------------------------ */
/*  Cumulative SOH drawdown — per-order shortage calculation            */
/* ------------------------------------------------------------------ */

/**
 * For each material, sorts all requirements by date, walks through
 * consuming SOH, and identifies which order+material combos have shortages.
 */
function calculateShortages(
  sohData: Map<string, SohRecord>,
  requirementsByMaterial: Map<string, RequirementEntry[]>,
): Map<string, { shortageQty: number; soh: number; totalReq: number }> {
  const shortageMap = new Map<string, { shortageQty: number; soh: number; totalReq: number }>();

  for (const [material, requirements] of requirementsByMaterial) {
    const sohEntry = sohData.get(material);
    let remainingSOH = sohEntry ? sohEntry.stock : 0;

    // Sort by date then order for deterministic ordering
    const sorted = [...requirements].sort((a, b) => {
      const dateComp = a.reqDate.localeCompare(b.reqDate);
      return dateComp !== 0 ? dateComp : a.order.localeCompare(b.order);
    });

    // Aggregate net qty per order (a single order can have multiple BOM lines for same material)
    const orderTotals = new Map<string, { netQty: number; reqDate: string }>();
    for (const req of sorted) {
      const existing = orderTotals.get(req.order);
      if (existing) {
        existing.netQty += req.netQty;
      } else {
        orderTotals.set(req.order, { netQty: req.netQty, reqDate: req.reqDate });
      }
    }

    // Walk through orders by date, consuming SOH
    const sortedOrders = [...orderTotals.entries()].sort((a, b) =>
      a[1].reqDate.localeCompare(b[1].reqDate),
    );

    for (const [order, { netQty }] of sortedOrders) {
      // Skip fully-withdrawn orders (netQty <= 0) — they don't consume SOH
      if (netQty <= 0) continue;
      const needed = netQty;
      const shortageQty = Math.max(0, needed - remainingSOH);
      remainingSOH = Math.max(0, remainingSOH - needed);

      if (shortageQty > 0) {
        shortageMap.set(`${order}|${material}`, {
          shortageQty: Math.round(shortageQty * 100) / 100,
          soh: sohEntry ? sohEntry.stock : 0,
          totalReq: Math.round(needed * 100) / 100,
        });
      }
    }
  }

  return shortageMap;
}

/* ------------------------------------------------------------------ */
/*  SOH Report extraction                                              */
/* ------------------------------------------------------------------ */

interface SohRecord {
  stock: number;
  description: string;
  uom: string;
}

function extractSohData(files: ParsedFile[]): Map<string, SohRecord> {
  const map = new Map<string, SohRecord>();
  const sohFile = files.find((f) => f.type === "soh");
  if (!sohFile) return map;

  const { headers, rows } = sohFile;
  for (const row of rows) {
    const material = rowValue(row, headers, "material");
    if (!material) continue;

    const stock = rowNumeric(row, headers, "unrestricted") ?? 0;
    const description = rowValue(row, headers, "material description", "description") ?? "";
    const uom = rowValue(row, headers, "tag based unit of measure", "base unit of measure", "base unit", "buom", "uom") ?? "KG";

    // Accumulate stock across rows for the same material
    const existing = map.get(material);
    if (existing) {
      existing.stock += stock;
    } else {
      map.set(material, { stock, description, uom });
    }
  }
  return map;
}

function lookupByMaterial<T>(
  map: Map<string, T>,
  materialCode: string | null,
  bulkCode: string | null,
): T | undefined {
  if (materialCode) {
    const exact = map.get(materialCode);
    if (exact) return exact;
    // Try prefix match (material code without pack size suffix)
    const prefix = materialCode.split("-")[0];
    if (prefix) {
      const prefixMatch = map.get(prefix);
      if (prefixMatch) return prefixMatch;
    }
  }
  if (bulkCode) {
    return map.get(bulkCode);
  }
  return undefined;
}

export interface ShortageRecord {
  materialCode: string;
  materialDesc: string | null;
  materialType: "RM" | "PKG";
  requiredQty: number;
  sohQty: number;
  shortQty: number;
  uom: string;
}

/** Per-batch shortage detail for a single material */
export interface BatchShortageDetail {
  materialCode: string;
  requiredQty: number;
  shortQty: number;
}

export interface ProcessResult {
  batches: ImportBatch[];
  missingDates: number;
  /** Aggregated material shortages from BOM/SOH analysis */
  shortages: ShortageRecord[];
  /** Per-order material shortage links: Map<sapOrder, materialCode[]> */
  orderShortages: Map<string, string[]>;
  /** Per-batch shortage details: Map<sapOrder, BatchShortageDetail[]> */
  batchShortageDetails: Map<string, BatchShortageDetail[]>;
  /** BOM components keyed by fill order number — used to update existing fill orders */
  requirementsByFillOrder: Map<string, string[]>;
}

export function processFilesToBatches(files: ParsedFile[]): ProcessResult {
  // Accept either our "bulk_data" type or "coois" (generic production order list)
  const bulkFile =
    files.find((f) => f.type === "bulk_data") ??
    files.find((f) => f.type === "coois");
  if (!bulkFile) return { batches: [], missingDates: 0, shortages: [], orderShortages: new Map(), batchShortageDetails: new Map(), requirementsByFillOrder: new Map() };
  const todayISO = new Date().toISOString().split("T")[0]!;

  // Extract supplementary data from other file types
  const zp40Data = extractZp40Data(files);
  const zw04Data = extractZw04Data(files);
  const mb52Data = extractMb52Data(files);
  const sohData = extractSohData(files);
  const fillData = extractFillData(files);
  const requirements = extractRequirements(files);

  // MB52 and SOH are the same source data — MB52 files with plant columns
  // are classified as "mb52" not "soh", so merge MB52 stock into sohData
  for (const [material, mb52] of mb52Data) {
    if (mb52.safetyStock != null) {
      const existing = sohData.get(material);
      if (existing) {
        // MB52 aggregates across plants, prefer higher value
        existing.stock = Math.max(existing.stock, mb52.safetyStock);
      } else {
        sohData.set(material, {
          stock: mb52.safetyStock,
          description: mb52.description ?? "",
          uom: mb52.uom ?? "KG",
        });
      }
    }
  }

  // Enrich fill records with BOM component material codes from requirements
  for (const fills of fillData.values()) {
    for (const fo of fills) {
      if (!fo.fillOrder) continue;
      const reqs = requirements.byOrder.get(fo.fillOrder);
      if (reqs) {
        fo.components = [...new Set(reqs.map((r) => r.material))];
      }
    }
  }

  // Calculate per-order material shortages using cumulative SOH drawdown
  const shortageMap = calculateShortages(sohData, requirements.byMaterial);

  const { headers, rows } = bulkFile;
  const seen = new Set<string>();
  const batches: ImportBatch[] = [];

  for (const row of rows) {
    // SAP Bulk Data: "Order" column (not "bulk order")
    const sapOrder = rowValue(row, headers, "order", "bulk order", "sap order");
    if (!sapOrder) continue;
    // Deduplicate by order number
    if (seen.has(sapOrder)) continue;
    seen.add(sapOrder);

    const materialCode = rowValue(row, headers, "material");
    // SAP uses "Material description" (not just "description")
    const materialDesc =
      rowValue(row, headers, "material description", "description", "material desc") ?? null;
    // Bulk code is the material code itself (ends in -B) — no separate column in bulk export
    const bulkCode = materialCode ?? null;
    // SAP date columns: use rawValue to preserve Excel serial numbers
    const dateRaw = rowRawValue(
      row, headers,
      "basic start date", "basic start", "basic fin",
      "sched.start", "scheduled start", "sched. start",
      "planned start", "plan date", "plan start",
      "start date", "finish date", "due date",
      "date",
    );
    const planDate = excelDateToISO(dateRaw);
    // SAP Bulk Data: "Total order quantity" (not "order quantity")
    const batchVolume = rowNumeric(
      row, headers,
      "total order quantity", "total order qty", "order quantity", "quantity", "volume",
    );
    // SAP Bulk Data: "ColGrp" (not "colour group")
    const colorGroup =
      rowValue(row, headers, "colgrp", "colour group", "color group", "color") ?? null;

    // Pack size: try bulk data columns, then fill data link, then extract from material code
    const fills = fillData.get(sapOrder) ?? [];
    const firstFill = fills[0] ?? null;
    const packSize =
      rowValue(row, headers, "pack size", "pck size") ??
      firstFill?.packSize ??
      extractPackSize(materialCode);

    // Cross-reference with ZP40 coverage data
    const zp40 = lookupByMaterial(zp40Data, materialCode, bulkCode);
    const stockCover = zp40?.stockCover ?? null;
    const forecast = zp40?.forecast ?? null;
    const availableStock = zp40?.availableStock ?? null;

    // Cross-reference with ZW04 purchase order data
    const zw04 = lookupByMaterial(zw04Data, materialCode, bulkCode);
    const poDate = zw04?.poDate ?? null;
    const poQuantity = zw04?.poQuantity ?? null;

    // Cross-reference with MB52 stock data, fall back to ZP40 safety stock
    const mb52 = lookupByMaterial(mb52Data, materialCode, bulkCode);
    const safetyStock = mb52?.safetyStock ?? zp40?.safetyStock ?? null;

    // Determine RM shortages from cumulative SOH drawdown
    // Check if any BOM component for this order has a shortage
    // Check bulk order requirements (RM shortages)
    const bulkReqs = requirements.byOrder.get(sapOrder) ?? [];
    let hasRmShortage = false;
    let hasPkgShortage = false;
    for (const req of bulkReqs) {
      const key = `${req.order}|${req.material}`;
      if (shortageMap.has(key)) {
        hasRmShortage = true;
      }
    }
    // Check fill order requirements (packaging shortages)
    // Collect all fill order numbers: from Fill Data file, then fallback to inline bulk data column
    const fillOrderNumbers = fills
      .map((f) => f.fillOrder)
      .filter((fo): fo is string => !!fo);
    // Fallback: if no Fill Data file was uploaded, check if bulk data has an inline "fill order" column
    if (fillOrderNumbers.length === 0) {
      const inlineFillOrder = rowValue(row, headers, "fill order", "fill_order");
      if (inlineFillOrder) fillOrderNumbers.push(inlineFillOrder);
    }
    for (const fillOrder of fillOrderNumbers) {
      const fillReqs = requirements.byOrder.get(fillOrder) ?? [];
      for (const req of fillReqs) {
        const key = `${req.order}|${req.material}`;
        if (shortageMap.has(key)) {
          hasPkgShortage = true;
        }
      }
    }

    // Derive material shortage: BOM-level shortage, stock out, or critical coverage
    const materialShortage =
      hasRmShortage ||
      hasPkgShortage ||
      (availableStock != null && availableStock <= 0) ||
      (stockCover != null && stockCover < 15);

    // SAP resource assignment columns
    const sapMixerResource = rowValue(row, headers, "mixer resource", "mixer") ?? null;
    const sapDisperser1 = rowValue(row, headers, "dispersion 1 resource", "disperser 1") ?? null;
    const sapDisperser2 = rowValue(row, headers, "dispersion 2 resource", "disperser 2") ?? null;
    const sapPreMixCount = rowNumeric(row, headers, "pre mix count", "pre mix", "premix") ?? null;
    // Second premix count follows the "Dispersion 2 Resource" column (both columns may share the same header name)
    const sapPreMixCount2 = rowNumericAfter(row, headers, "dispersion 2 resource") ?? null;
    const sapIpt = rowNumeric(row, headers, "ipt") ?? null;
    // Fill order linking from Fill Data file (first fill used for legacy single-value fields)
    const sapFillOrder = firstFill?.fillOrder ?? rowValue(row, headers, "fill order") ?? null;
    const sapFillQuantity = firstFill?.fillQuantity ?? rowNumeric(row, headers, "fill quantity", "fill qty") ?? null;
    const sapFillMaterial = firstFill?.fillMaterial ?? null;
    const sapFillPackSize = firstFill?.packSize ?? null;

    // Vetting columns: Mat.Grping = needs vetting, Recipient = has been vetted
    const matGrpRaw = rowValue(row, headers, "mat.grping", "matgrping", "mat grping", "mat. grping");
    const recipientRaw = rowValue(row, headers, "recipient");
    const matGrping = matGrpRaw?.trim().toUpperCase() === "X";
    const recipient = recipientRaw?.trim().toUpperCase() === "X";

    batches.push({
      sapOrder,
      materialCode,
      materialDescription: materialDesc,
      bulkCode,
      planDate: planDate ?? todayISO,
      batchVolume,
      sapColorGroup: colorGroup,
      packSize,
      rmAvailable: !hasRmShortage && !(availableStock != null && availableStock <= 0),
      packagingAvailable: !hasPkgShortage,
      stockCover,
      safetyStock,
      poDate,
      poQuantity,
      forecast,
      materialShortage,
      sapMixerResource,
      sapDisperser1,
      sapDisperser2,
      sapPreMixCount,
      sapPreMixCount2,
      sapIpt,
      sapFillOrder,
      sapFillQuantity,
      sapFillMaterial,
      sapFillPackSize,
      sapFillOrders: fills,
      matGrping,
      recipient,
    });
  }

  // Check whether the file had a recognisable date column at all
  const hasDateColumn = !!findColumn(
    headers,
    "basic start date", "basic start", "basic fin",
    "sched.start", "scheduled start", "sched. start",
    "planned start", "plan date", "plan start",
    "start date", "finish date", "due date", "date",
  );

  // Build aggregated shortage records from the SOH/BOM analysis
  const shortagesAgg = new Map<string, ShortageRecord>();
  const orderShortages = new Map<string, string[]>();

  for (const [key] of shortageMap) {
    const [order, material] = key.split("|");
    if (!order || !material) continue;

    // Track per-order shortage links
    if (!orderShortages.has(order)) orderShortages.set(order, []);
    orderShortages.get(order)!.push(material);

    // Aggregate at material level — accumulate shortages across all orders
    if (!shortagesAgg.has(material)) {
      const sohEntry = sohData.get(material);
      const reqEntries = requirements.byMaterial.get(material) ?? [];
      const totalReq = reqEntries.reduce((sum, r) => sum + r.netQty, 0);
      const description = sohEntry?.description ?? reqEntries[0]?.description ?? null;
      // UOM: prefer SOH report, fall back to requirements file, then default
      const uom = sohEntry?.uom ?? (reqEntries[0]?.uom || "KG");
      // Heuristic: fill-linked materials are PKG, others are RM
      // Check Fill Data file linkage AND inline fill order columns from bulk data
      const isFillLinked = batches.some((b) => {
        const batchFills = fillData.get(b.sapOrder) ?? [];
        if (batchFills.some((f) => f.fillOrder && reqEntries.some((r) => r.order === f.fillOrder))) return true;
        // Fallback: check inline fill order from the batch
        return b.sapFillOrder != null && reqEntries.some((r) => r.order === b.sapFillOrder);
      });

      // Sum shortage across ALL orders for this material
      let totalShortage = 0;
      for (const [k, v] of shortageMap) {
        if (k.endsWith(`|${material}`)) {
          totalShortage += v.shortageQty;
        }
      }

      shortagesAgg.set(material, {
        materialCode: material,
        materialDesc: description,
        materialType: isFillLinked ? "PKG" : "RM",
        requiredQty: Math.round(totalReq * 100) / 100,
        sohQty: Math.round((sohEntry?.stock ?? 0) * 100) / 100,
        shortQty: -Math.round(totalShortage * 100) / 100, // Store as negative
        uom,
      });
    }
  }

  // Build per-batch shortage details: for each batch (bulk order), collect
  // the per-order requirement and shortage from its bulk order + linked fill orders
  const batchShortageDetails = new Map<string, BatchShortageDetail[]>();
  for (const batch of batches) {
    const details: BatchShortageDetail[] = [];
    // Collect all relevant orders for this batch: bulk order + fill orders
    const relevantOrders = [batch.sapOrder];
    const batchFills = fillData.get(batch.sapOrder) ?? [];
    for (const f of batchFills) {
      if (f.fillOrder) relevantOrders.push(f.fillOrder);
    }
    // Fallback: include inline fill order from bulk data if no Fill Data file
    if (batchFills.length === 0 && batch.sapFillOrder) {
      relevantOrders.push(batch.sapFillOrder);
    }
    // Check each order's materials against the shortage map
    for (const order of relevantOrders) {
      const reqs = requirements.byOrder.get(order) ?? [];
      // Aggregate requirements per material for this order
      const matTotals = new Map<string, number>();
      for (const req of reqs) {
        matTotals.set(req.material, (matTotals.get(req.material) ?? 0) + req.netQty);
      }
      for (const [material, reqQty] of matTotals) {
        const key = `${order}|${material}`;
        const shortage = shortageMap.get(key);
        if (shortage) {
          details.push({
            materialCode: material,
            requiredQty: Math.round(reqQty * 100) / 100,
            shortQty: -Math.round(shortage.shortageQty * 100) / 100, // negative when short
          });
        }
      }
    }
    if (details.length > 0) {
      batchShortageDetails.set(batch.sapOrder, details);
    }
  }

  // Build a map of fill order number → component material codes from requirements
  const requirementsByFillOrder = new Map<string, string[]>();
  for (const [order, reqs] of requirements.byOrder) {
    requirementsByFillOrder.set(order, [...new Set(reqs.map((r) => r.material))]);
  }

  return {
    batches,
    missingDates: hasDateColumn ? 0 : batches.length,
    shortages: [...shortagesAgg.values()],
    orderShortages,
    batchShortageDetails,
    requirementsByFillOrder,
  };
}

export function useImport() {
  const { site } = useCurrentSite();
  const queryClient = useQueryClient();
  const { data: resources = [] } = useResources();
  const { data: substitutionRules = [] } = useSubstitutionRules();
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [shortageRecords, setShortageRecords] = useState<ShortageRecord[]>([]);
  const [batchShortageDetailsState, setBatchShortageDetailsState] = useState<Map<string, BatchShortageDetail[]>>(new Map());
  const [resourceAssignments, setResourceAssignments] = useState<Map<string, string>>(new Map());
  const [disperserAssignmentsState, setDisperserAssignmentsState] = useState<Map<string, string>>(new Map());
  const [disperser2AssignmentsState, setDisperser2AssignmentsState] = useState<Map<string, string>>(new Map());
  const [requirementsByFillOrder, setRequirementsByFillOrder] = useState<Map<string, string[]>>(new Map());
  const [unresolvedConflicts, setUnresolvedConflicts] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);

  const addFiles = useCallback(
    async (fileList: File[]) => {
      setIsProcessing(true);
      try {
        const parsed: ParsedFile[] = [];
        for (const file of fileList) {
          try {
            const rows = await parseExcelFile(file);
            if (rows.length === 0) {
              toast.warning(`"${file.name}" has no data rows`);
              continue;
            }
            const headers = Object.keys(rows[0]!);
            const type = detectFileType(headers);
            if (type === "unknown") {
              toast.warning(`"${file.name}" could not be matched to a known SAP file type`);
            }
            parsed.push({
              fileName: file.name,
              type,
              headers,
              rows,
              rowCount: rows.length,
            });
          } catch (fileErr) {
            console.error(`Failed to parse ${file.name}:`, fileErr);
            toast.error(`Failed to parse "${file.name}": ${fileErr instanceof Error ? fileErr.message : "unknown error"}`);
          }
        }
        if (parsed.length > 0) {
          // Replace existing files of the same type (e.g. new SOH replaces old SOH)
          const newTypes = new Set(parsed.map((f) => f.type));
          const kept = files.filter((f) => !newTypes.has(f.type));
          const allFiles = [...kept, ...parsed];
          setFiles(allFiles);

          // Auto-process if we have bulk data
          const result = processFilesToBatches(allFiles);
          setBatches(result.batches);
          setShortageRecords(result.shortages);
          setBatchShortageDetailsState(result.batchShortageDetails);
          setRequirementsByFillOrder(result.requirementsByFillOrder);

          // Auto-assign resources: prefer SAP mixer resource codes, fall back to generic
          if (resources.length > 0 && result.batches.length > 0) {
            const assignments = new Map<string, string>();
            const disperserAssignments = new Map<string, string>();
            const disperser2Assignments = new Map<string, string>();

            // Build lookup: resource_code (uppercase) → resource ID
            const codeToId = new Map<string, string>();
            // Also build type-specific lookups for disperser-only matching
            const disperserCodeToId = new Map<string, string>();
            for (const r of resources) {
              if (r.active) {
                // Store both raw code and normalised (strip hyphens) for flexible matching
                codeToId.set(r.resourceCode.toUpperCase(), r.id);
                codeToId.set(r.resourceCode.replace(/-/g, "").toUpperCase(), r.id);
                if (r.resourceType === "disperser") {
                  disperserCodeToId.set(r.resourceCode.toUpperCase(), r.id);
                  disperserCodeToId.set(r.resourceCode.replace(/-/g, "").toUpperCase(), r.id);
                }
              }
            }

            // Group mapping: SAP prefix/code → DB resource code prefix for child resolution
            // POT groups: SAP uses POTSB99, POTWB88, etc. → resolve to individual pot children
            // MIXER37: SAP uses MIXER37 → resolve to MIXER37A or MIXER37B child
            const groupMap: Record<string, string> = {
              POTSB: "SBPOT",
              POTWB: "WBPOT",
              POTSS: "SSPOT",
              MIXER37: "MIXER37",
            };
            // Also handle text forms from SAP
            const exactGroupMap: Record<string, string> = {
              "SB POT": "SBPOT",
              "WB POT": "WBPOT",
              "SS POT": "SSPOT",
            };

            // Track group child load for round-robin: resourceId → count
            const childLoadCounts = new Map<string, number>();

            const batchesNeedingGenericAssignment: typeof result.batches = [];

            for (const batch of result.batches) {
              // --- Disperser assignment (independent of mixer) ---
              if (batch.sapDisperser1) {
                const dCode = batch.sapDisperser1.toUpperCase();
                const disperserId = disperserCodeToId.get(dCode);
                if (disperserId) {
                  disperserAssignments.set(batch.sapOrder, disperserId);
                }
              }
              // --- Disperser 2 assignment (second dispersion stage) ---
              if (batch.sapDisperser2) {
                const d2Code = batch.sapDisperser2.toUpperCase();
                const disperser2Id = disperserCodeToId.get(d2Code);
                if (disperser2Id) {
                  disperser2Assignments.set(batch.sapOrder, disperser2Id);
                }
              }

              // --- Primary resource assignment (mixer) ---
              // Only use mixer resource for plan_resource_id; disperser is stored separately
              const sapResource = batch.sapMixerResource;
              if (!sapResource) {
                batchesNeedingGenericAssignment.push(batch);
                continue;
              }

              const code = sapResource.toUpperCase();

              // Check exact text group mapping first (e.g. "SB POT" → SBPOT*)
              const exactPrefix = exactGroupMap[code];
              if (exactPrefix) {
                const children = resources.filter(
                  (r) => r.active && r.resourceCode.toUpperCase().startsWith(exactPrefix),
                );
                if (children.length > 0) {
                  const best = children.reduce((a, b) =>
                    (childLoadCounts.get(a.id) ?? 0) <= (childLoadCounts.get(b.id) ?? 0) ? a : b,
                  );
                  assignments.set(batch.sapOrder, best.id);
                  childLoadCounts.set(best.id, (childLoadCounts.get(best.id) ?? 0) + 1);
                  continue;
                }
              }

              // Direct match (e.g. MIXER42 → MIXER42)
              const directId = codeToId.get(code);
              if (directId) {
                assignments.set(batch.sapOrder, directId);
                continue;
              }

              // Group prefix resolution: e.g. POTSB99 → SBPOT* children, MIXER37 → MIXER37A/B
              let resolved = false;
              for (const [sapPrefix, dbPrefix] of Object.entries(groupMap)) {
                if (code.startsWith(sapPrefix) && code !== sapPrefix + "A" && code !== sapPrefix + "B") {
                  const children = resources.filter(
                    (r) => r.active && r.resourceCode.toUpperCase().startsWith(dbPrefix)
                      && r.resourceCode.toUpperCase() !== code, // exclude exact match (already tried)
                  );
                  if (children.length > 0) {
                    const best = children.reduce((a, b) =>
                      (childLoadCounts.get(a.id) ?? 0) <= (childLoadCounts.get(b.id) ?? 0) ? a : b,
                    );
                    assignments.set(batch.sapOrder, best.id);
                    childLoadCounts.set(best.id, (childLoadCounts.get(best.id) ?? 0) + 1);
                    resolved = true;
                  }
                  break;
                }
              }

              if (!resolved) {
                batchesNeedingGenericAssignment.push(batch);
              }
            }

            // Fall back to generic capacity-based assignment for unmatched batches
            if (batchesNeedingGenericAssignment.length > 0) {
              const genericAssignments = assignBatchesToResources(
                batchesNeedingGenericAssignment,
                resources,
              );
              for (const [sapOrder, resourceId] of genericAssignments) {
                assignments.set(sapOrder, resourceId);
              }
            }

            // --- Auto-resolve resource conflicts via substitution rules ---
            const enabledSubRules = substitutionRules.filter((r) => r.enabled);
            if (enabledSubRules.length > 0) {
              const { resolved, unresolved } = resolveConflictsWithSubstitutions(
                assignments,
                result.batches,
                resources,
                enabledSubRules,
              );
              setUnresolvedConflicts(unresolved);

              const movedCount = resolved.size;
              if (movedCount > 0 || unresolved.size > 0) {
                toast.info(
                  `${movedCount} conflict${movedCount !== 1 ? "s" : ""} auto-resolved` +
                    (unresolved.size > 0
                      ? ` · ${unresolved.size} need planner action`
                      : ""),
                );
              }
            } else {
              setUnresolvedConflicts(new Set());
            }

            setResourceAssignments(assignments);
            setDisperserAssignmentsState(disperserAssignments);
            setDisperser2AssignmentsState(disperser2Assignments);
            const sapDirectCount = result.batches.length - batchesNeedingGenericAssignment.length;
            const assignedCount = assignments.size;
            const unassignedCount = result.batches.length - assignedCount;
            if (assignedCount > 0) {
              toast.success(
                `Auto-assigned ${assignedCount} batch${assignedCount > 1 ? "es" : ""} to resources` +
                  (sapDirectCount > 0 ? ` (${sapDirectCount} from SAP)` : "") +
                  (unassignedCount > 0 ? ` (${unassignedCount} unassigned)` : ""),
              );
            }
          }

          toast.success(`Loaded ${parsed.length} file${parsed.length > 1 ? "s" : ""}`);
          if (result.missingDates > 0) {
            toast.warning(
              `No date column found — ${result.missingDates} batch${result.missingDates > 1 ? "es" : ""} defaulted to today's date`,
            );
          }
        }
      } catch (err) {
        console.error("File import error:", err);
        toast.error(`Import failed: ${err instanceof Error ? err.message : "unknown error"}`);
      } finally {
        setIsProcessing(false);
      }
    },
    [files, resources, substitutionRules],
  );

  const clearFiles = useCallback(() => {
    setFiles([]);
    setBatches([]);
    setShortageRecords([]);
    setResourceAssignments(new Map());
    setDisperserAssignmentsState(new Map());
    setDisperser2AssignmentsState(new Map());
  }, []);

  const importMutation = useMutation({
    mutationFn: async ({
      data,
      mode,
    }: {
      data: ImportBatch[];
      mode: ImportMode;
    }): Promise<{ mode: ImportMode }> => {
      if (!site) throw new Error("No site selected");

      // ---- SOH-only update: refresh stock fields on existing batches ----
      if (mode === "soh_update") {
        // Extract SOH and MB52 data from the uploaded files
        const sohData = extractSohData(files);
        const mb52Data = extractMb52Data(files);
        // Merge MB52 stock into sohData (same logic as processFilesToBatches)
        for (const [material, mb52] of mb52Data) {
          if (mb52.safetyStock != null) {
            const existing = sohData.get(material);
            if (existing) {
              existing.stock = Math.max(existing.stock, mb52.safetyStock);
            } else {
              sohData.set(material, {
                stock: mb52.safetyStock,
                description: mb52.description ?? "",
                uom: mb52.uom ?? "KG",
              });
            }
          }
        }

        if (sohData.size === 0) throw new Error("No SOH data found in uploaded files");

        // Fetch all existing batches for this site
        const { data: existingBatches, error: fetchErr } = await supabase
          .from("batches")
          .select("id, sap_order, material_code, bulk_code")
          .eq("site_id", site.id);
        if (fetchErr) throw fetchErr;
        if (!existingBatches || existingBatches.length === 0) {
          throw new Error("No existing batches to update — upload Bulk Data first");
        }

        // Clear ALL safety_stock first so stale values don't persist
        const { error: clearErr } = await supabase
          .from("batches")
          .update({ safety_stock: null } as never)
          .eq("site_id", site.id);
        if (clearErr) throw clearErr;

        // Set safety_stock from new SOH data by matching material_code
        let updatedCount = 0;
        for (const batch of existingBatches) {
          const materialCode = batch.material_code as string | null;
          const bulkCode = batch.bulk_code as string | null;
          const sohEntry = lookupByMaterial(sohData, materialCode, bulkCode);
          if (sohEntry) {
            const { error: updateErr } = await supabase
              .from("batches")
              .update({ safety_stock: sohEntry.stock } as never)
              .eq("id", batch.id as string);
            if (updateErr) {
              console.error(`Failed to update SOH for batch ${batch.sap_order}:`, updateErr);
            } else {
              updatedCount++;
            }
          }
        }

        // Recalculate shortages using existing requirements from linked_fill_orders
        // Fetch all linked fill orders with their components
        const { data: fillOrderRows } = await supabase
          .from("linked_fill_orders")
          .select("batch_id, fill_order, components")
          .eq("site_id", site.id);

        // Fetch all batches with their requirements context
        const { data: allBatches } = await supabase
          .from("batches")
          .select("id, sap_order, material_code, bulk_code")
          .eq("site_id", site.id);

        // Build a requirements-by-material map from existing fill order components
        // and recalculate material_shortage flag on each batch
        const batchMaterialMap = new Map<string, string[]>();
        for (const fo of (fillOrderRows ?? [])) {
          const components = (fo.components as string[] | null) ?? [];
          const batchId = fo.batch_id as string;
          const existing = batchMaterialMap.get(batchId) ?? [];
          existing.push(...components);
          batchMaterialMap.set(batchId, existing);
        }

        // Update material_shortage flag: batch is short if any of its component
        // materials have SOH = 0 (simple heuristic when we don't have full BOM qty)
        for (const batch of (allBatches ?? [])) {
          const bId = batch.id as string;
          const components = batchMaterialMap.get(bId) ?? [];
          const materialCode = batch.material_code as string | null;
          const bulkCode = batch.bulk_code as string | null;

          // Check if bulk material itself has stock
          const bulkSoh = lookupByMaterial(sohData, materialCode, bulkCode);
          const bulkHasStock = bulkSoh ? bulkSoh.stock > 0 : true; // assume OK if not in SOH

          // Check component materials
          let componentShort = false;
          for (const comp of components) {
            const compSoh = sohData.get(comp);
            if (compSoh && compSoh.stock <= 0) {
              componentShort = true;
              break;
            }
          }

          const materialShortage = !bulkHasStock || componentShort;
          const rmAvailable = bulkHasStock;
          const packagingAvailable = !componentShort;

          await supabase
            .from("batches")
            .update({
              material_shortage: materialShortage,
              rm_available: rmAvailable,
              packaging_available: packagingAvailable,
            } as never)
            .eq("id", bId);
        }

        toast.success(`SOH updated on ${updatedCount} of ${existingBatches.length} batches`);
        return { mode }; // Skip normal import flow
      }

      /** Derive vetting status from Mat.Grping / Recipient columns */
      const deriveVettingStatus = (b: ImportBatch): string => {
        if (!b.matGrping) return "not_required";
        return b.recipient ? "approved" : "pending";
      };

      /** SAP-sourced fields that should always be updated from import data */
      const buildSapFields = (b: ImportBatch) => ({
        site_id: site.id,
        sap_order: b.sapOrder,
        material_code: b.materialCode,
        material_description: b.materialDescription,
        bulk_code: b.bulkCode,
        plan_date: b.planDate,
        plan_resource_id: resourceAssignments.get(b.sapOrder) ?? null,
        plan_disperser_id: disperserAssignmentsState.get(b.sapOrder) ?? null,
        plan_disperser2_id: disperser2AssignmentsState.get(b.sapOrder) ?? null,
        batch_volume: b.batchVolume,
        sap_color_group: b.sapColorGroup,
        pack_size: b.packSize,
        rm_available: b.rmAvailable,
        packaging_available: b.packagingAvailable,
        stock_cover: b.stockCover,
        safety_stock: b.safetyStock,
        po_date: b.poDate,
        po_quantity: b.poQuantity,
        forecast: b.forecast,
        material_shortage: b.materialShortage,
        premix_count: b.sapPreMixCount ?? 0,
        premix_count_2: b.sapPreMixCount2 ?? 0,
        ipt: b.sapIpt,
        fill_requirement:
          b.sapIpt === 1 ? "Fill within 24hrs" : b.sapIpt === 2 ? "Fill within 48hrs" : "Standard",
      });

      if (mode === "replace") {
        // Replace: delete all existing, insert fresh with defaults
        const { error: delError } = await supabase
          .from("batches")
          .delete()
          .eq("site_id", site.id);
        if (delError) throw delError;

        const rows = data.map((b) => ({
          ...buildSapFields(b),
          status: "Planned",
          vetting_status: deriveVettingStatus(b),
          vetted_by: null,
          vetted_at: null,
          vetting_comment: null,
        }));
        const { error } = await supabase.from("batches").insert(rows as never);
        if (error) throw error;
      } else if (mode === "merge") {
        // Merge: fetch existing to preserve vetting state, insert new with defaults
        const sapOrders = data.map((b) => b.sapOrder);
        const { data: existingRows } = await supabase
          .from("batches")
          .select("sap_order, status, vetting_status, vetted_by, vetted_at, vetting_comment")
          .eq("site_id", site.id)
          .in("sap_order", sapOrders);

        const existingMap = new Map(
          (existingRows ?? []).map((r: Record<string, unknown>) => [
            r.sap_order as string,
            {
              status: r.status as string,
              vetting_status: r.vetting_status as string,
              vetted_by: r.vetted_by as string | null,
              vetted_at: r.vetted_at as string | null,
              vetting_comment: r.vetting_comment as string | null,
            },
          ]),
        );

        const rows = data.map((b) => {
          const existing = existingMap.get(b.sapOrder);
          return {
            ...buildSapFields(b),
            // Preserve workflow fields for existing rows, derive from SAP for new
            status: existing?.status ?? "Planned",
            vetting_status: existing?.vetting_status ?? deriveVettingStatus(b),
            vetted_by: existing?.vetted_by ?? null,
            vetted_at: existing?.vetted_at ?? null,
            vetting_comment: existing?.vetting_comment ?? null,
          };
        });

        const { error } = await supabase
          .from("batches")
          .upsert(rows as never, { onConflict: "site_id,sap_order" });
        if (error) throw error;
      } else {
        // Update: only update existing rows, preserve vetting state
        const sapOrders = data.map((b) => b.sapOrder);
        const { data: existingRows } = await supabase
          .from("batches")
          .select("sap_order, status, vetting_status, vetted_by, vetted_at, vetting_comment")
          .eq("site_id", site.id)
          .in("sap_order", sapOrders);

        const existingMap = new Map(
          (existingRows ?? []).map((r: Record<string, unknown>) => [
            r.sap_order as string,
            {
              status: r.status as string,
              vetting_status: r.vetting_status as string,
              vetted_by: r.vetted_by as string | null,
              vetted_at: r.vetted_at as string | null,
              vetting_comment: r.vetting_comment as string | null,
            },
          ]),
        );

        for (const b of data) {
          const existing = existingMap.get(b.sapOrder);
          if (!existing) continue; // Update mode: skip rows that don't exist

          const { error } = await supabase
            .from("batches")
            .update({
              ...buildSapFields(b),
              // Preserve existing workflow fields
              status: existing.status,
              vetting_status: existing.vetting_status,
              vetted_by: existing.vetted_by,
              vetted_at: existing.vetted_at,
              vetting_comment: existing.vetting_comment,
            } as never)
            .eq("site_id", site.id)
            .eq("sap_order", b.sapOrder);
          if (error) throw error;
        }
      }

      // ---- Fill orders, requirements, and shortages (inside mutationFn so they
      //      complete reliably — onSuccess with .mutate() can be interrupted) ----

      // Create linked fill orders for batches that have fill data
      const fillBatches = data.filter((b) => b.sapFillOrders.length > 0 || b.sapFillOrder);
      if (fillBatches.length > 0) {
        // Look up batch IDs by SAP order
        const sapOrders = fillBatches.map((b) => b.sapOrder);
        const { data: batchRows } = await supabase
          .from("batches")
          .select("id, sap_order")
          .eq("site_id", site.id)
          .in("sap_order", sapOrders);

        if (batchRows && batchRows.length > 0) {
          const orderToId = new Map(
            batchRows.map((r: Record<string, unknown>) => [r.sap_order as string, r.id as string]),
          );

          // Delete existing fill orders for these batches first
          const batchIds = batchRows.map((r: Record<string, unknown>) => r.id as string);
          await supabase
            .from("linked_fill_orders")
            .delete()
            .in("batch_id", batchIds);

          // Insert all fill orders (multiple per batch when applicable)
          const fillRows: Record<string, unknown>[] = [];
          for (const b of fillBatches) {
            const batchId = orderToId.get(b.sapOrder);
            if (!batchId) continue;

            if (b.sapFillOrders.length > 0) {
              // Insert each fill order from the fill data file
              for (const fo of b.sapFillOrders) {
                fillRows.push({
                  batch_id: batchId,
                  site_id: site.id,
                  fill_order: fo.fillOrder || null,
                  fill_material: fo.fillMaterial,
                  fill_description: b.materialDescription,
                  pack_size: fo.packSize ?? b.packSize,
                  quantity: fo.fillQuantity,
                  components: fo.components.length > 0 ? fo.components : null,
                });
              }
            } else if (b.sapFillOrder) {
              // Fallback: single fill order from inline bulk data columns
              fillRows.push({
                batch_id: batchId,
                site_id: site.id,
                fill_order: b.sapFillOrder,
                fill_material: b.sapFillMaterial,
                fill_description: b.materialDescription,
                pack_size: b.sapFillPackSize ?? b.packSize,
                quantity: b.sapFillQuantity,
                components: null,
              });
            }
          }

          // Deduplicate by fill_order within each batch (not globally —
          // the same fill order can legitimately link to multiple batches)
          const dedupedRows = fillRows.filter((r, idx) => {
            const fo = r.fill_order as string | null;
            if (!fo) return true;
            const bId = r.batch_id as string;
            // Keep if this is the first occurrence of this fill_order for this batch
            return !fillRows.slice(0, idx).some(
              (prev) => prev.fill_order === fo && prev.batch_id === bId,
            );
          });

          if (dedupedRows.length > 0) {
            const { error: fillInsertErr } = await supabase.from("linked_fill_orders").insert(dedupedRows as never);
            if (fillInsertErr) {
              console.error("Failed to insert linked_fill_orders:", fillInsertErr);
            }
          }
        }
      }

      // Cross-reference requirements back to existing fill orders to populate components
      // This handles: requirements file imported separately after fill data,
      // or requirements file imported with fill data but components weren't set
      if (requirementsByFillOrder.size > 0) {
        const fillOrderNumbers = [...requirementsByFillOrder.keys()];
        // Chunk to stay within Supabase .in() limits
        const chunkSize = 200;
        for (let i = 0; i < fillOrderNumbers.length; i += chunkSize) {
          const chunk = fillOrderNumbers.slice(i, i + chunkSize);
          // Find existing fill orders in DB that match requirement order numbers
          const { data: existingFills } = await supabase
            .from("linked_fill_orders")
            .select("id, fill_order, components")
            .eq("site_id", site.id)
            .in("fill_order", chunk);

          if (existingFills && existingFills.length > 0) {
            for (const row of existingFills) {
              const fo = row.fill_order as string;
              const currentComponents = (row.components as string[] | null) ?? [];
              const reqComponents = requirementsByFillOrder.get(fo);
              if (!reqComponents || reqComponents.length === 0) continue;
              // Merge: keep existing + add new from requirements
              const merged = [...new Set([...currentComponents, ...reqComponents])];
              if (merged.length === currentComponents.length) continue; // No change
              await supabase
                .from("linked_fill_orders")
                .update({ components: merged } as never)
                .eq("id", row.id as string);
            }
          }
        }
      }

      // Clean up stale shortage data before re-inserting current shortages.
      // Delete all batch_material_shortages for the imported batches so rows
      // from materials that are no longer short don't persist.
      const importedSapOrders = data.map((b) => b.sapOrder);
      const { data: importedBatchRows } = await supabase
        .from("batches")
        .select("id")
        .eq("site_id", site.id)
        .in("sap_order", importedSapOrders);
      const importedBatchIds = (importedBatchRows ?? []).map((r: Record<string, unknown>) => r.id as string);
      if (importedBatchIds.length > 0) {
        await supabase
          .from("batch_material_shortages")
          .delete()
          .eq("site_id", site.id)
          .in("batch_id", importedBatchIds);
      }

      // Delete material_shortages that are no longer short (will be re-created if still short)
      const currentShortMaterials = new Set(shortageRecords.map((s) => s.materialCode));
      const { data: existingShortages } = await supabase
        .from("material_shortages")
        .select("id, material_code")
        .eq("site_id", site.id);
      const staleIds = (existingShortages ?? [])
        .filter((r: Record<string, unknown>) => !currentShortMaterials.has(r.material_code as string))
        .map((r: Record<string, unknown>) => r.id as string);
      if (staleIds.length > 0) {
        // Delete batch links for stale shortages first (FK constraint)
        await supabase
          .from("batch_material_shortages")
          .delete()
          .eq("site_id", site.id)
          .in("shortage_id", staleIds);
        await supabase
          .from("material_shortages")
          .delete()
          .eq("site_id", site.id)
          .in("id", staleIds);
      }

      // Upsert material shortages from BOM/SOH analysis
      if (shortageRecords.length > 0) {
        const shortageRows = shortageRecords.map((s) => ({
          site_id: site.id,
          material_code: s.materialCode,
          material_desc: s.materialDesc,
          material_type: s.materialType,
          required_qty: s.requiredQty,
          soh_qty: s.sohQty,
          short_qty: s.shortQty,
          uom: s.uom,
          updated_at: new Date().toISOString(),
        }));

        const { error: msError } = await supabase
          .from("material_shortages")
          .upsert(shortageRows as never, {
            onConflict: "site_id,material_code",
            ignoreDuplicates: false,
          });
        if (msError) {
          console.error("Failed to upsert material_shortages:", msError);
        }

        // Link shortages to batches
        const { data: shortageDbRows, error: shortageQueryError } = await supabase
          .from("material_shortages")
          .select("id, material_code")
          .eq("site_id", site.id);

        if (shortageQueryError) {
          console.error("Failed to query material_shortages:", shortageQueryError);
        }

        const materialToShortageId = new Map(
          (shortageDbRows ?? []).map((r: Record<string, unknown>) => [
            r.material_code as string,
            r.id as string,
          ]),
        );

        console.log("[Import] Shortage linking: shortageRecords=%d, materialToShortageId=%d, batchShortageDetailsState=%d",
          shortageRecords.length, materialToShortageId.size, batchShortageDetailsState.size);

        // Get batch IDs for linking
        const allSapOrders = data.map((b) => b.sapOrder);
        const { data: batchIdRows } = await supabase
          .from("batches")
          .select("id, sap_order")
          .eq("site_id", site.id)
          .in("sap_order", allSapOrders);

        const orderToBatchId = new Map(
          (batchIdRows ?? []).map((r: Record<string, unknown>) => [
            r.sap_order as string,
            r.id as string,
          ]),
        );

        console.log("[Import] orderToBatchId=%d, allSapOrders=%d", orderToBatchId.size, allSapOrders.length);

        // Collect per-batch shortage details, deduplicating by batch_id+shortage_id
        // (a material can appear in both bulk and fill orders for the same batch)
        const batchShortageAgg = new Map<string, {
          site_id: string;
          batch_id: string;
          shortage_id: string;
          short_qty: number;
          required_qty: number;
        }>();

        for (const [sapOrder, details] of batchShortageDetailsState) {
          const bId = orderToBatchId.get(sapOrder);
          if (!bId) continue;
          for (const detail of details) {
            const shortageId = materialToShortageId.get(detail.materialCode);
            if (!shortageId) continue;
            const key = `${bId}|${shortageId}`;
            const existing = batchShortageAgg.get(key);
            if (existing) {
              // Sum across orders for the same batch+material
              existing.short_qty += detail.shortQty;
              existing.required_qty += detail.requiredQty;
            } else {
              batchShortageAgg.set(key, {
                site_id: site.id,
                batch_id: bId,
                shortage_id: shortageId,
                short_qty: detail.shortQty,
                required_qty: detail.requiredQty,
              });
            }
          }
        }

        const batchShortageRows = [...batchShortageAgg.values()];

        if (batchShortageRows.length > 0) {
          // Try with required_qty first
          const { error: bsError } = await supabase
            .from("batch_material_shortages")
            .upsert(batchShortageRows as never, {
              onConflict: "batch_id,shortage_id",
              ignoreDuplicates: false,
            });
          if (bsError) {
            // required_qty column may not exist — retry without it
            const rowsWithoutReqQty = batchShortageRows.map(
              ({ required_qty: _, ...rest }) => rest,
            );
            const { error: retryError } = await supabase
              .from("batch_material_shortages")
              .upsert(rowsWithoutReqQty as never, {
                onConflict: "batch_id,shortage_id",
                ignoreDuplicates: false,
              });
            if (retryError) {
              console.error("Failed to upsert batch_material_shortages:", retryError);
              toast.warning(`Shortage details could not be saved: ${retryError.message}`);
            } else {
              console.log("[Import] batch_material_shortages upserted %d rows (without required_qty)", rowsWithoutReqQty.length);
            }
          } else {
            console.log("[Import] batch_material_shortages upserted %d rows", batchShortageRows.length);
          }
        } else if (shortageRecords.length > 0) {
          console.warn("Shortage records found but no batch shortage rows were generated. batchShortageDetailsState size:", batchShortageDetailsState.size);
        }
      }
      // ---- Persist per-plant ZP40 coverage items ----
      const zp40File = files.find((f) => f.type === "zp40");
      if (zp40File && importedBatchIds.length > 0) {
        // Delete existing coverage items for these batches
        await supabase
          .from("batch_coverage_items")
          .delete()
          .eq("site_id", site.id)
          .in("batch_id", importedBatchIds);

        // Build order→batchId map for coverage linking
        const covOrderToBatchId = new Map(
          (await supabase
            .from("batches")
            .select("id, sap_order, bulk_code, material_code")
            .eq("site_id", site.id)
            .in("sap_order", data.map((b) => b.sapOrder))
            .then((r) => r.data ?? []))
            .map((r: Record<string, unknown>) => [r.sap_order as string, r.id as string]),
        );

        // Build bulkCode→batchId and materialCode→batchId lookups
        const bulkToBatchIds = new Map<string, string[]>();
        const matToBatchIds = new Map<string, string[]>();
        for (const b of data) {
          const batchId = covOrderToBatchId.get(b.sapOrder);
          if (!batchId) continue;
          const bulk = b.bulkCode ?? b.materialCode?.split("-")[0] ?? "";
          if (bulk) {
            const arr = bulkToBatchIds.get(bulk) ?? [];
            arr.push(batchId);
            bulkToBatchIds.set(bulk, arr);
          }
          if (b.materialCode) {
            const arr = matToBatchIds.get(b.materialCode) ?? [];
            arr.push(batchId);
            matToBatchIds.set(b.materialCode, arr);
          }
        }

        const zp40Headers = zp40File.headers;

        const planMatCol = findColumn(zp40Headers, "planning material", "planning mat");
        const matCol = findColumn(zp40Headers, "material");
        const descCol = findColumn(zp40Headers, "material description", "material desc", "description");
        const plantCol = findColumn(zp40Headers, "plant", "plnt");
        const availCol = findColumn(zp40Headers, "available stock", "available");
        const coverCol = findColumn(zp40Headers, "stock cover", "cover");
        const safetyCol = findColumn(zp40Headers, "safety stock");
        const fcstCol = findColumn(zp40Headers, "current month", "forecast");
        const nextPoCol = findColumn(zp40Headers, "nextpo", "next po", "next_po", "nextorder", "next order");

        // Also build PO lookup from ZW04 for coverage items
        const covPoLookup = new Map<string, { poDate: string | null; poQuantity: number }>();
        const zw04File = files.find((f) => f.type === "zw04");
        if (zw04File) {
          for (const row of zw04File.rows) {
            const mat = rowValue(row, zw04File.headers, "material");
            if (!mat) continue;
            const dateRaw = rowRawValue(row, zw04File.headers, "po.deliv.dt", "delivery date", "del. date");
            const poDate = excelDateToISO(dateRaw);
            const qty = rowNumeric(row, zw04File.headers, "remain.qty", "remain. qty", "remaining", "order quantity") ?? 0;
            if (!covPoLookup.has(mat)) {
              covPoLookup.set(mat, { poDate, poQuantity: qty });
            }
          }
        }

        const coverageRows: Record<string, unknown>[] = [];
        for (const row of zp40File.rows) {
          const planningMaterial = planMatCol ? String(row[planMatCol] ?? "") : "";
          const material = matCol ? String(row[matCol] ?? "") : "";
          const description = descCol ? String(row[descCol] ?? "") : "";
          const plant = plantCol ? String(row[plantCol] ?? "") : "";
          const availableStock = parseFloat(String(availCol ? row[availCol] ?? "0" : "0")) || 0;
          const stockCover = parseFloat(String(coverCol ? row[coverCol] ?? "0" : "0")) || 0;
          const safetyStock = parseFloat(String(safetyCol ? row[safetyCol] ?? "0" : "0")) || 0;
          const forecastM0 = parseFloat(String(fcstCol ? row[fcstCol] ?? "0" : "0")) || 0;
          const nextPoOrder = nextPoCol ? String(row[nextPoCol] ?? "") || null : null;

          // Classify coverage level based on available stock
          let level: string;
          if (availableStock <= 0) level = "Stock Out";
          else if (availableStock < 15) level = "Critical";
          else if (availableStock < 30) level = "Low";
          else level = "Good";

          // Cross-reference PO data
          const po = covPoLookup.get(planningMaterial) ?? covPoLookup.get(material);

          // Find which batches this ZP40 row applies to
          const matchedBatchIds = new Set<string>();
          for (const bId of bulkToBatchIds.get(planningMaterial) ?? []) matchedBatchIds.add(bId);
          for (const bId of matToBatchIds.get(material) ?? []) matchedBatchIds.add(bId);
          // Also try partial match on planning material against bulk codes
          if (planningMaterial) {
            for (const [bulk, bIds] of bulkToBatchIds) {
              if (planningMaterial.includes(bulk) || bulk.includes(planningMaterial)) {
                for (const bId of bIds) matchedBatchIds.add(bId);
              }
            }
          }

          for (const batchId of matchedBatchIds) {
            coverageRows.push({
              site_id: site.id,
              batch_id: batchId,
              planning_material: planningMaterial,
              material: material || null,
              description: description || null,
              plant: plant || null,
              available_stock: availableStock,
              stock_cover: stockCover,
              safety_stock: safetyStock,
              forecast_m0: forecastM0,
              po_date: po?.poDate ?? null,
              po_quantity: po?.poQuantity ?? 0,
              level,
              next_po_order: nextPoOrder,
            });
          }
        }

        if (coverageRows.length > 0) {
          // Insert in chunks to stay within Supabase limits
          const chunkSize = 500;
          for (let i = 0; i < coverageRows.length; i += chunkSize) {
            const chunk = coverageRows.slice(i, i + chunkSize);
            const { error: covError } = await supabase
              .from("batch_coverage_items")
              .insert(chunk as never);
            if (covError) {
              console.error("Failed to insert batch_coverage_items:", covError);
              break;
            }
          }
          console.log("[Import] Inserted %d batch_coverage_items rows", coverageRows.length);
        }
      }

      return { mode };
    },
    onSuccess: (result) => {
      // SOH-only update already shows its own toast
      if (result?.mode !== "soh_update") {
        if (site && shortageRecords.length > 0) {
          const shortCount = shortageRecords.length;
          toast.info(
            `${shortCount} material shortage${shortCount !== 1 ? "s" : ""} identified`,
          );
        }
        toast.success("Import completed successfully");
      }

      queryClient.invalidateQueries({ queryKey: ["batches"] });
      queryClient.invalidateQueries({ queryKey: ["material_shortages"] });
      queryClient.invalidateQueries({ queryKey: ["batch_material_shortages"] });
      queryClient.invalidateQueries({ queryKey: ["batch_coverage_items"] });
      queryClient.invalidateQueries({ queryKey: ["fill_orders_week"] });
      clearFiles();
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to import batches",
      );
    },
  });

  // Detect SOH-only mode: files present, has SOH/MB52, but no bulk data
  const hasBulk = files.some((f) => f.type === "bulk_data" || f.type === "coois");
  const hasSoh = files.some((f) => f.type === "soh" || f.type === "mb52");
  const sohOnly = files.length > 0 && !hasBulk && hasSoh;

  return {
    files,
    batches,
    sohOnly,
    isProcessing,
    unresolvedConflicts,
    addFiles,
    clearFiles,
    importBatches: importMutation.mutate,
    isImporting: importMutation.isPending,
    importError: importMutation.error,
    importSuccess: importMutation.isSuccess,
  };
}
