import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import { useResources } from "./use-resources";
import { parseExcelFile, excelDateToISO, type ParsedRow } from "@/lib/utils/excel-parser";
import { assignBatchesToResources } from "@/lib/utils/resource-assignment";

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
  sapIpt: number | null;
  sapFillOrder: string | null;
  sapFillQuantity: number | null;
}

export type ImportMode = "replace" | "update" | "merge";

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
}

/** Fill Data record keyed by batch/order number */
interface FillRecord {
  fillOrder: string;
  fillMaterial: string | null;
  packSize: string | null;
  fillQuantity: number | null;
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

    // Accumulate across plants for the same material
    const existing = map.get(material);
    if (existing) {
      existing.safetyStock = (existing.safetyStock ?? 0) + (unrestricted ?? 0);
    } else {
      map.set(material, { safetyStock: unrestricted });
    }
  }
  return map;
}

/* ------------------------------------------------------------------ */
/*  Fill Data extraction — links fill orders to bulk orders             */
/* ------------------------------------------------------------------ */

function extractFillData(files: ParsedFile[]): Map<string, FillRecord> {
  const map = new Map<string, FillRecord>();
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

    // Keep first fill order per bulk batch (or could accumulate, but typically 1:1)
    if (!map.has(batchOrder)) {
      map.set(batchOrder, { fillOrder, fillMaterial, packSize, fillQuantity });
    }
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
  const reqFile = files.find((f) => f.type === "fill_components");
  if (!reqFile) return { byOrder, byMaterial };

  const { headers, rows } = reqFile;
  for (const row of rows) {
    const order = rowValue(row, headers, "order");
    const material = rowValue(row, headers, "material");
    if (!order || !material) continue;

    const reqQty = rowNumeric(row, headers, "requirement quantity") ?? 0;
    const qtyWithdrawn = rowNumeric(row, headers, "quantity withdrawn") ?? 0;
    const netQty = Math.max(0, reqQty - qtyWithdrawn);
    if (netQty <= 0) continue; // Already fulfilled

    const dateRaw = rowRawValue(row, headers, "requirement date");
    const reqDate = excelDateToISO(dateRaw) ?? "";
    const description = rowValue(row, headers, "material description", "description") ?? "";

    const entry: RequirementEntry = { order, material, description, reqQty, qtyWithdrawn, netQty, reqDate };

    if (!byOrder.has(order)) byOrder.set(order, []);
    byOrder.get(order)!.push(entry);

    if (!byMaterial.has(material)) byMaterial.set(material, []);
    byMaterial.get(material)!.push(entry);
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

    for (const [order, info] of sortedOrders) {
      const needed = info.netQty;
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

    // Accumulate stock across rows for the same material
    const existing = map.get(material);
    if (existing) {
      existing.stock += stock;
    } else {
      map.set(material, { stock, description });
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

export interface ProcessResult {
  batches: ImportBatch[];
  missingDates: number;
}

export function processFilesToBatches(files: ParsedFile[]): ProcessResult {
  // Accept either our "bulk_data" type or "coois" (generic production order list)
  const bulkFile =
    files.find((f) => f.type === "bulk_data") ??
    files.find((f) => f.type === "coois");
  if (!bulkFile) return { batches: [], missingDates: 0 };
  const todayISO = new Date().toISOString().split("T")[0]!;

  // Extract supplementary data from other file types
  const zp40Data = extractZp40Data(files);
  const zw04Data = extractZw04Data(files);
  const mb52Data = extractMb52Data(files);
  const sohData = extractSohData(files);
  const fillData = extractFillData(files);
  const requirements = extractRequirements(files);

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
    const fill = fillData.get(sapOrder);
    const packSize =
      rowValue(row, headers, "pack size", "pck size") ??
      fill?.packSize ??
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
    const orderReqs = requirements.byOrder.get(sapOrder) ?? [];
    let hasRmShortage = false;
    let hasPkgShortage = false;
    for (const req of orderReqs) {
      const key = `${sapOrder}|${req.material}`;
      if (shortageMap.has(key)) {
        // Heuristic: packaging materials are typically in EA or units, RM in KG/L
        // Also fill-linked requirements are packaging
        const isFillLinked = fill && fill.fillOrder && req.order === fill.fillOrder;
        if (isFillLinked) {
          hasPkgShortage = true;
        } else {
          hasRmShortage = true;
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
    const sapIpt = rowNumeric(row, headers, "ipt") ?? null;
    // Fill order linking from Fill Data file
    const sapFillOrder = fill?.fillOrder ?? rowValue(row, headers, "fill order") ?? null;
    const sapFillQuantity = fill?.fillQuantity ?? rowNumeric(row, headers, "fill quantity", "fill qty") ?? null;

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
      sapIpt,
      sapFillOrder,
      sapFillQuantity,
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

  return { batches, missingDates: hasDateColumn ? 0 : batches.length };
}

export function useImport() {
  const { site } = useCurrentSite();
  const queryClient = useQueryClient();
  const { data: resources = [] } = useResources();
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [resourceAssignments, setResourceAssignments] = useState<Map<string, string>>(new Map());
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
          const allFiles = [...files, ...parsed];
          setFiles(allFiles);

          // Auto-process if we have bulk data
          const result = processFilesToBatches(allFiles);
          setBatches(result.batches);

          // Auto-assign resources: prefer SAP mixer resource codes, fall back to generic
          if (resources.length > 0 && result.batches.length > 0) {
            const assignments = new Map<string, string>();

            // Build lookup: resource_code (uppercase) → resource ID
            const codeToId = new Map<string, string>();
            for (const r of resources) {
              if (r.active) {
                // Store both raw code and normalised (strip hyphens) for flexible matching
                codeToId.set(r.resourceCode.toUpperCase(), r.id);
                codeToId.set(r.resourceCode.replace(/-/g, "").toUpperCase(), r.id);
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
              if (!batch.sapMixerResource) {
                batchesNeedingGenericAssignment.push(batch);
                continue;
              }

              const code = batch.sapMixerResource.toUpperCase();

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

            setResourceAssignments(assignments);
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
    [files, resources],
  );

  const clearFiles = useCallback(() => {
    setFiles([]);
    setBatches([]);
    setResourceAssignments(new Map());
  }, []);

  const importMutation = useMutation({
    mutationFn: async ({
      data,
      mode,
    }: {
      data: ImportBatch[];
      mode: ImportMode;
    }) => {
      if (!site) throw new Error("No site selected");

      /** SAP-sourced fields that should always be updated from import data */
      const buildSapFields = (b: ImportBatch) => ({
        site_id: site.id,
        sap_order: b.sapOrder,
        material_code: b.materialCode,
        material_description: b.materialDescription,
        bulk_code: b.bulkCode,
        plan_date: b.planDate,
        plan_resource_id: resourceAssignments.get(b.sapOrder) ?? null,
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
          vetting_status: "pending",
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
            // Preserve workflow fields for existing rows, defaults for new
            status: existing?.status ?? "Planned",
            vetting_status: existing?.vetting_status ?? "pending",
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      clearFiles();
      toast.success("Import completed successfully");
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to import batches",
      );
    },
  });

  return {
    files,
    batches,
    isProcessing,
    addFiles,
    clearFiles,
    importBatches: importMutation.mutate,
    isImporting: importMutation.isPending,
    importError: importMutation.error,
    importSuccess: importMutation.isSuccess,
  };
}
