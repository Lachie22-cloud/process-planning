import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Upload, AlertTriangle } from "lucide-react";
import type { ImportBatch, ImportMode } from "@/hooks/use-import";

interface ImportPreviewProps {
  batches: ImportBatch[];
  isImporting: boolean;
  importError: Error | null;
  importSuccess: boolean;
  onImport: (data: { data: ImportBatch[]; mode: ImportMode }) => void;
}

const MODE_OPTIONS: { value: ImportMode; label: string; description: string }[] = [
  {
    value: "merge",
    label: "Merge (Recommended)",
    description: "Add new batches and update existing ones by SAP order number",
  },
  {
    value: "update",
    label: "Update Only",
    description: "Only update batches that already exist — no new records created",
  },
  {
    value: "replace",
    label: "Replace All",
    description: "Delete all existing batches for this site and import fresh",
  },
];

const PREVIEW_LIMIT = 20;

export function ImportPreview({
  batches,
  isImporting,
  importError,
  importSuccess,
  onImport,
}: ImportPreviewProps) {
  const [mode, setMode] = useState<ImportMode>("merge");

  if (batches.length === 0) return null;

  const withDates = batches.filter((b) => b.planDate);
  const withVolume = batches.filter((b) => b.batchVolume != null);
  const withCoverage = batches.filter((b) => b.stockCover != null);
  const shortages = batches.filter((b) => b.materialShortage);
  const missingDates = batches.length - withDates.length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            Import Preview — {batches.length} batches
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{withDates.length} with dates</Badge>
            <Badge variant="secondary">{withVolume.length} with volume</Badge>
            {withCoverage.length > 0 && (
              <Badge variant="secondary">{withCoverage.length} with coverage</Badge>
            )}
            {shortages.length > 0 && (
              <Badge variant="destructive">{shortages.length} shortages</Badge>
            )}
            {missingDates > 0 && (
              <Badge variant="outline" className="border-amber-300 text-amber-700">
                {missingDates} missing dates
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Preview table */}
        <div className="max-h-96 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Material</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Pack Size</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Volume (L)</TableHead>
                <TableHead>Colour</TableHead>
                <TableHead className="text-right">Cover (days)</TableHead>
                <TableHead className="text-right">Safety Stk</TableHead>
                <TableHead>PO Date</TableHead>
                <TableHead className="text-right">PO Qty</TableHead>
                <TableHead className="text-right">Forecast</TableHead>
                <TableHead>Shortage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.slice(0, PREVIEW_LIMIT).map((batch, i) => (
                <TableRow
                  key={`${batch.sapOrder}-${i}`}
                  className={batch.materialShortage ? "bg-red-50/50" : undefined}
                >
                  <TableCell className="font-medium">
                    {batch.sapOrder}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {batch.materialCode ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">
                    {batch.materialDescription ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {batch.packSize ?? "—"}
                  </TableCell>
                  <TableCell>{batch.planDate ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {batch.batchVolume?.toLocaleString() ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {batch.sapColorGroup ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {batch.stockCover != null ? (
                      <span
                        className={
                          batch.stockCover <= 0
                            ? "text-red-700 font-semibold"
                            : batch.stockCover < 15
                              ? "text-orange-700"
                              : batch.stockCover < 30
                                ? "text-amber-700"
                                : "text-green-700"
                        }
                      >
                        {batch.stockCover.toFixed(0)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {batch.safetyStock?.toLocaleString() ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {batch.poDate ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {batch.poQuantity?.toLocaleString() ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {batch.forecast?.toLocaleString() ?? "—"}
                  </TableCell>
                  <TableCell>
                    {batch.materialShortage ? (
                      <Badge variant="destructive" className="text-[10px]">
                        Short
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">OK</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {batches.length > PREVIEW_LIMIT && (
                <TableRow>
                  <TableCell
                    colSpan={13}
                    className="text-center text-sm text-muted-foreground"
                  >
                    …and {batches.length - PREVIEW_LIMIT} more
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Import mode selection */}
        <div>
          <h4 className="mb-2 text-sm font-semibold">Import Mode</h4>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer flex-col rounded-lg border p-3 transition-colors ${
                  mode === opt.value
                    ? "border-primary bg-primary/5"
                    : "hover:border-muted-foreground/30"
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="importMode"
                    value={opt.value}
                    checked={mode === opt.value}
                    onChange={() => setMode(opt.value)}
                    className="accent-primary"
                  />
                  <span className="text-sm font-medium">{opt.label}</span>
                </div>
                <span className="mt-1 text-xs text-muted-foreground pl-5">
                  {opt.description}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Error / success */}
        {importError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Import failed: {importError.message}
            </AlertDescription>
          </Alert>
        )}

        {importSuccess && (
          <Alert>
            <AlertDescription>
              Successfully imported {batches.length} batches.
            </AlertDescription>
          </Alert>
        )}

        {/* Replace warning */}
        {mode === "replace" && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              This will delete <strong>all existing batches</strong> for this
              site before importing. This cannot be undone.
            </AlertDescription>
          </Alert>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button
            onClick={() => onImport({ data: batches, mode })}
            disabled={isImporting}
          >
            {isImporting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Importing…
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Import {batches.length} Batches
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
