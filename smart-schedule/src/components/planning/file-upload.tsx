import { useCallback, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Upload, FileSpreadsheet, X, Loader2, Info } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { toast } from "sonner";
import type { ParsedFile, SapFileType } from "@/hooks/use-import";

interface FileUploadProps {
  files: ParsedFile[];
  isProcessing: boolean;
  onAddFiles: (files: File[]) => void;
  onClear: () => void;
}

const FILE_TYPE_LABELS: Record<SapFileType, string> = {
  bulk_data: "Bulk Data",
  fill_data: "Fill Data",
  coois: "COOIS",
  zp40: "ZP40",
  zw04: "ZW04",
  mb52: "MB52",
  soh: "SOH Report",
  fill_components: "Fill Components",
  bulk_components: "Bulk Components",
  ibp_forecast: "IBP Forecast",
  unknown: "Unknown",
};

/** Key columns expected for each file type. Absence is noted but not blocking. */
const EXPECTED_COLUMNS: Partial<Record<SapFileType, string[]>> = {
  bulk_data: ["Order", "Material", "Basic start date", "Total order quantity", "ColGrp"],
  zp40: ["Planning material", "Material", "Stock cover", "Available stock", "Safety stock"],
  zw04: ["Material", "PO.Deliv.Dt"],
  mb52: ["Material", "Unrestricted"],
  soh: ["Material", "Unrestricted", "Base Unit of Measure"],
  fill_data: ["Order", "Material", "PCK Size", "Total order quantity"],
  ibp_forecast: ["Product ID", "Time Periods", "Actuals Qty"],
};

function getMissingColumns(file: ParsedFile): string[] {
  const expected = EXPECTED_COLUMNS[file.type];
  if (!expected) return [];
  const lower = new Set(file.headers.map((h) => h.toLowerCase().trim()));
  return expected.filter((col) => !lower.has(col.toLowerCase()));
}

export function FileUpload({
  files,
  isProcessing,
  onAddFiles,
  onClear,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;
      const accepted = Array.from(fileList).filter((f) => {
        const name = f.name.toLowerCase();
        return name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv");
      });
      if (accepted.length > 0) {
        onAddFiles(accepted);
      } else if (fileList.length > 0) {
        toast.error("Unsupported file type. Please upload .xlsx, .xls, or .csv files.");
      }
    },
    [onAddFiles],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <Card
        className={cn(
          "cursor-pointer border-2 border-dashed transition-colors",
          isDragging && "border-primary bg-primary/5",
          !isDragging && "hover:border-primary/50",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <CardContent className="flex flex-col items-center justify-center py-10">
          {isProcessing ? (
            <>
              <Loader2 className="mb-3 h-10 w-10 animate-spin text-primary" />
              <p className="text-sm font-medium">Processing files…</p>
            </>
          ) : (
            <>
              <Upload className="mb-3 h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-medium">
                Drop SAP spreadsheets here or click to browse
              </p>
              <div className="mt-1 flex items-center justify-center gap-1">
                <p className="text-xs text-muted-foreground">
                  Accepts .xlsx, .xls, .csv — Bulk Data, Fill Data, COOIS, ZP40,
                  ZW04, MB52, SOH Report, Requirements, IBP Forecast
                </p>
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="How rules are applied during upload"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-80 text-xs leading-relaxed"
                    side="top"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="mb-2 font-semibold text-sm">How rules are applied</p>
                    <p className="mb-3 text-muted-foreground">
                      During upload, batches are assigned to mixers based on SAP resource codes
                      and capacity only. Most scheduling rules are not enforced at this stage.
                    </p>
                    <div className="mb-3">
                      <p className="font-medium mb-1">Applied at upload</p>
                      <ul className="space-y-0.5 text-muted-foreground list-disc list-inside">
                        <li>Resource active status</li>
                        <li>Batch volume within capacity</li>
                        <li>Maximum batches per day</li>
                      </ul>
                    </div>
                    <div className="mb-3">
                      <p className="font-medium mb-1">Enforced on all moves (drag-drop and AI)</p>
                      <ul className="space-y-0.5 text-muted-foreground list-disc list-inside">
                        <li>Substitution rules (blocked if no rule allows the mixer change)</li>
                        <li>Chemical base compatibility</li>
                        <li>Colour transition constraints</li>
                      </ul>
                    </div>
                    <div className="mb-3">
                      <p className="font-medium mb-1">Evaluated by the AI agent only</p>
                      <ul className="space-y-0.5 text-muted-foreground list-disc list-inside">
                        <li>Trunk line and group preferences</li>
                        <li>WOM and workload balancing</li>
                      </ul>
                    </div>
                    <p className="text-muted-foreground">
                      After uploading, run an AI scan to evaluate the full rule set.
                      The agent will propose any changes as a draft for you to review and approve.
                    </p>
                  </PopoverContent>
                </Popover>
              </div>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              // Reset so the same file can be re-selected
              e.target.value = "";
            }}
          />
        </CardContent>
      </Card>

      {/* Detected files list */}
      {files.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              Detected Files ({files.length})
            </h3>
            <Button variant="ghost" size="sm" onClick={onClear}>
              <X className="mr-1 h-3 w-3" />
              Clear all
            </Button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {files.map((file, i) => {
              const missing = getMissingColumns(file);
              return (
                <Card key={`${file.fileName}-${i}`} className="p-3">
                  <div className="flex items-start gap-3">
                    <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {file.fileName}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge
                          variant={
                            file.type === "unknown" ? "destructive" : "secondary"
                          }
                          className="text-[10px]"
                        >
                          {FILE_TYPE_LABELS[file.type]}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {file.rowCount.toLocaleString()} rows
                        </span>
                      </div>
                      {missing.length > 0 && (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          Columns not found: {missing.join(", ")}
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
