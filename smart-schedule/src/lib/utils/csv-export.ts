/**
 * CSV export utilities for batch schedule data.
 */

import type { Batch } from "@/types/batch";
import type { Resource } from "@/types/resource";

function escapeCsvField(value: string | number | boolean | null | undefined): string {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsvRow(fields: (string | number | boolean | null | undefined)[]): string {
  return fields.map(escapeCsvField).join(",");
}

function downloadCsv(csvContent: string, filename: string) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export full batch details as CSV.
 */
export function exportBatchesCsv(batches: Batch[], resources: Resource[]) {
  const resourceMap = new Map(resources.map((r) => [r.id, r]));

  const header = [
    "SAP Order",
    "Material Code",
    "Material Description",
    "Bulk Code",
    "Plan Date",
    "Resource",
    "Volume (L)",
    "Status",
    "Colour Group",
    "Pack Size",
    "RM Available",
    "Packaging Available",
    "Stock Cover",
    "Safety Stock",
    "Forecast",
    "Material Shortage",
    "Vetting Status",
    "Vetted By",
    "Job Location",
    "PO Date",
    "PO Quantity",
    "QC Observed Stage",
  ];

  const rows = batches.map((b) => {
    const resource = b.planResourceId ? resourceMap.get(b.planResourceId) : null;
    return toCsvRow([
      b.sapOrder,
      b.materialCode,
      b.materialDescription,
      b.bulkCode,
      b.planDate,
      resource?.displayName ?? resource?.resourceCode ?? "",
      b.batchVolume,
      b.status,
      b.sapColorGroup,
      b.packSize,
      b.rmAvailable ? "Yes" : "No",
      b.packagingAvailable ? "Yes" : "No",
      b.stockCover,
      b.safetyStock,
      b.forecast,
      b.materialShortage ? "Yes" : "No",
      b.vettingStatus,
      b.vettedBy,
      b.jobLocation,
      b.poDate,
      b.poQuantity,
      b.qcObservedStage,
    ]);
  });

  const csv = [toCsvRow(header), ...rows].join("\n");
  downloadCsv(csv, `batches-export-${new Date().toISOString().slice(0, 10)}.csv`);
}

/**
 * Export simplified batch dates CSV.
 */
export function exportBatchDatesCsv(batches: Batch[], resources: Resource[]) {
  const resourceMap = new Map(resources.map((r) => [r.id, r]));

  const header = ["SAP Order", "Plan Date", "Resource"];
  const rows = batches.map((b) => {
    const resource = b.planResourceId ? resourceMap.get(b.planResourceId) : null;
    return toCsvRow([
      b.sapOrder,
      b.planDate,
      resource?.displayName ?? resource?.resourceCode ?? "",
    ]);
  });

  const csv = [toCsvRow(header), ...rows].join("\n");
  downloadCsv(csv, `batch-dates-${new Date().toISOString().slice(0, 10)}.csv`);
}

function formatDateDDMMYYYY(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const [year, month, day] = dateStr.split("-");
  return `${day}.${month}.${year}`;
}

/**
 * Export batch numbers with plan dates in DD.MM.YYYY format (SAP-style).
 */
export function exportBatchDateExport(batches: Batch[]) {
  const header = ["Batch Number", "Plan Date"];
  const rows = batches.map((b) =>
    toCsvRow([b.sapOrder, formatDateDDMMYYYY(b.planDate)]),
  );

  const csv = [toCsvRow(header), ...rows].join("\n");
  downloadCsv(csv, `batch-date-export-${new Date().toISOString().slice(0, 10)}.csv`);
}
