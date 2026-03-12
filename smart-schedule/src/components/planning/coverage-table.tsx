import { useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ParsedFile } from "@/hooks/use-import";
import { excelDateToISO } from "@/lib/utils/excel-parser";
import type { Batch } from "@/types/batch";

interface CoverageTableProps {
  files: ParsedFile[];
  batches: Batch[];
}

interface CoverageRow {
  planningMaterial: string;
  material: string;
  description: string;
  plant: string;
  availableStock: number;
  stockCover: number;
  safetyStock: number;
  forecastM0: number;
  poDate: string | null;
  poQuantity: number;
  materialShortage: boolean;
  level: "Stock Out" | "Critical" | "Low" | "Good";
}

function classifyCoverage(
  availableStock: number,
  stockCover: number,
): CoverageRow["level"] {
  if (stockCover <= 0 || availableStock <= 0) return "Stock Out";
  if (stockCover < 15) return "Critical";
  if (stockCover < 30) return "Low";
  return "Good";
}

const LEVEL_STYLES: Record<
  CoverageRow["level"],
  { badge: "destructive" | "outline" | "secondary"; text: string }
> = {
  "Stock Out": { badge: "destructive", text: "text-red-700" },
  Critical: { badge: "outline", text: "text-orange-700" },
  Low: { badge: "outline", text: "text-amber-700" },
  Good: { badge: "secondary", text: "text-green-700" },
};

function findColumnIdx(headers: string[], ...keywords: string[]): number {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const kw of keywords) {
    const idx = lower.findIndex((h) => h.includes(kw));
    if (idx >= 0) return idx;
  }
  return -1;
}

function cellValue(
  row: Record<string, string | number | null>,
  rawHeaders: string[],
  idx: number,
  fallbackIdx: number,
): string {
  const colKey = rawHeaders[idx >= 0 ? idx : fallbackIdx] ?? "";
  return String(row[colKey] ?? "");
}

function cellNumeric(
  row: Record<string, string | number | null>,
  rawHeaders: string[],
  idx: number,
  fallbackIdx: number,
): number {
  return parseFloat(cellValue(row, rawHeaders, idx, fallbackIdx)) || 0;
}

export function CoverageTable({ files, batches }: CoverageTableProps) {
  const zp40File = files.find((f) => f.type === "zp40");
  const zw04File = files.find((f) => f.type === "zw04");
  const mb52File = files.find((f) => f.type === "mb52");

  const coverageRows = useMemo<CoverageRow[]>(() => {
    if (!zp40File) return [];

    const headers = zp40File.headers.map((h) => h.toLowerCase().trim());

    const planMatIdx = findColumnIdx(headers, "planning material", "planning mat");
    const matIdx = headers.findIndex(
      (h) => h === "material" && !h.includes("desc"),
    );
    const descIdx = findColumnIdx(headers, "material desc", "description");
    const plantIdx = headers.findIndex((h) => h === "plant");
    const availIdx = findColumnIdx(headers, "available stock", "available");
    const coverIdx = findColumnIdx(headers, "stock cover", "cover");
    const fcst0Idx = findColumnIdx(headers, "current month", "forecast");

    // Build ZW04 PO lookup by material
    const poLookup = new Map<string, { poDate: string | null; poQuantity: number }>();
    if (zw04File) {
      const zw04Headers = zw04File.headers.map((h) => h.toLowerCase().trim());
      const zw04MatIdx = findColumnIdx(zw04Headers, "material");
      const zw04DateIdx = findColumnIdx(zw04Headers, "delivery date", "del. date", "po date");
      const zw04QtyIdx = findColumnIdx(zw04Headers, "order quantity", "po quantity", "quantity");
      for (const row of zw04File.rows) {
        const mat = cellValue(row, zw04File.headers, zw04MatIdx, 0);
        if (!mat) continue;
        // Get raw value to preserve numeric type for Excel serial dates
        const dateColKey = zw04File.headers[zw04DateIdx >= 0 ? zw04DateIdx : 1] ?? "";
        const dateRaw = row[dateColKey] ?? null;
        // Normalize Excel serial dates and varied date formats to ISO
        const poDate = excelDateToISO(
          typeof dateRaw === "number" ? dateRaw : dateRaw != null ? String(dateRaw) : null,
        );
        const qty = cellNumeric(row, zw04File.headers, zw04QtyIdx, 2);
        if (!poLookup.has(mat)) {
          poLookup.set(mat, { poDate, poQuantity: qty });
        }
      }
    }

    // Build MB52 safety stock lookup by material
    const safetyLookup = new Map<string, number>();
    if (mb52File) {
      const mb52Headers = mb52File.headers.map((h) => h.toLowerCase().trim());
      const mb52MatIdx = findColumnIdx(mb52Headers, "material");
      const mb52SafeIdx = findColumnIdx(mb52Headers, "safety stock", "safety stk");
      for (const row of mb52File.rows) {
        const mat = cellValue(row, mb52File.headers, mb52MatIdx, 0);
        if (!mat) continue;
        const safety = cellNumeric(row, mb52File.headers, mb52SafeIdx, 1);
        if (!safetyLookup.has(mat)) {
          safetyLookup.set(mat, safety);
        }
      }
    }

    // Build a set of bulk codes from current batches for cross-referencing
    const batchBulkCodes = new Set(
      batches
        .map((b) => b.bulkCode ?? b.materialCode?.split("-")[0] ?? "")
        .filter(Boolean),
    );

    const rawHeaders = zp40File.headers;
    return zp40File.rows
      .map((row) => {
        const planningMaterial = cellValue(row, rawHeaders, planMatIdx, 0);
        const material = cellValue(row, rawHeaders, matIdx, 1);
        const description = cellValue(row, rawHeaders, descIdx, 2);
        const plant = cellValue(row, rawHeaders, plantIdx, 3);
        const availableStock = cellNumeric(row, rawHeaders, availIdx, 8);
        const stockCover = cellNumeric(row, rawHeaders, coverIdx, 10);
        const forecastM0 = cellNumeric(row, rawHeaders, fcst0Idx, 15);

        // Cross-reference PO data
        const po = poLookup.get(planningMaterial) ?? poLookup.get(material);
        const poDate = po?.poDate ?? null;
        const poQuantity = po?.poQuantity ?? 0;

        // Cross-reference safety stock
        const safetyStock =
          safetyLookup.get(planningMaterial) ?? safetyLookup.get(material) ?? 0;

        const level = classifyCoverage(availableStock, stockCover);
        const materialShortage = level === "Stock Out" || level === "Critical";

        return {
          planningMaterial,
          material,
          description,
          plant,
          availableStock,
          stockCover,
          safetyStock,
          forecastM0,
          poDate,
          poQuantity,
          materialShortage,
          level,
        };
      })
      .filter(
        (row) =>
          // Only show rows relevant to imported batches (or all if no batches)
          batchBulkCodes.size === 0 ||
          batchBulkCodes.has(row.planningMaterial) ||
          batchBulkCodes.has(row.material),
      )
      .sort((a, b) => {
        // Worst coverage first
        const order: Record<string, number> = {
          "Stock Out": 0,
          Critical: 1,
          Low: 2,
          Good: 3,
        };
        return (order[a.level] ?? 3) - (order[b.level] ?? 3);
      });
  }, [zp40File, zw04File, mb52File, batches]);

  if (!zp40File || coverageRows.length === 0) return null;

  const stockOutCount = coverageRows.filter(
    (r) => r.level === "Stock Out",
  ).length;
  const criticalCount = coverageRows.filter(
    (r) => r.level === "Critical",
  ).length;
  const lowCount = coverageRows.filter((r) => r.level === "Low").length;
  const goodCount = coverageRows.filter((r) => r.level === "Good").length;
  const shortageCount = coverageRows.filter((r) => r.materialShortage).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            Material Coverage (ZP40) — {coverageRows.length} materials
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {stockOutCount > 0 && (
              <Badge variant="destructive">{stockOutCount} Stock Out</Badge>
            )}
            {criticalCount > 0 && (
              <Badge
                variant="outline"
                className="border-orange-300 text-orange-700"
              >
                {criticalCount} Critical
              </Badge>
            )}
            {lowCount > 0 && (
              <Badge
                variant="outline"
                className="border-amber-300 text-amber-700"
              >
                {lowCount} Low
              </Badge>
            )}
            <Badge variant="secondary">{goodCount} Good</Badge>
            {shortageCount > 0 && (
              <Badge variant="destructive">{shortageCount} Shortages</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="max-h-96 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Coverage</TableHead>
                <TableHead>Planning Material</TableHead>
                <TableHead>Material</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Plant</TableHead>
                <TableHead className="text-right">Available Stock</TableHead>
                <TableHead className="text-right">Cover (days)</TableHead>
                <TableHead className="text-right">Safety Stock</TableHead>
                <TableHead className="text-right">Forecast M0</TableHead>
                <TableHead>PO Date</TableHead>
                <TableHead className="text-right">PO Qty</TableHead>
                <TableHead>Shortage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {coverageRows.map((row, i) => {
                const style = LEVEL_STYLES[row.level];
                return (
                  <TableRow
                    key={`${row.planningMaterial}-${row.material}-${i}`}
                    className={row.materialShortage ? "bg-red-50/50" : undefined}
                  >
                    <TableCell>
                      <Badge variant={style.badge} className="text-[10px]">
                        {row.level}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.planningMaterial || "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.material || "—"}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">
                      {row.description || "—"}
                    </TableCell>
                    <TableCell className="text-xs">{row.plant || "—"}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {row.availableStock.toLocaleString()}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono tabular-nums ${style.text}`}
                    >
                      {row.stockCover.toFixed(0)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {row.safetyStock > 0 ? row.safetyStock.toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {row.forecastM0.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.poDate || "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {row.poQuantity > 0 ? row.poQuantity.toLocaleString() : "—"}
                    </TableCell>
                    <TableCell>
                      {row.materialShortage ? (
                        <Badge variant="destructive" className="text-[10px]">
                          Short
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">OK</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
