import { useMemo } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { BarChart3 } from "lucide-react";
import type { Batch } from "@/types/batch";
import type { ParsedFile } from "@/hooks/use-import";

interface CoveragePopupProps {
  batch: Batch;
  zp40File?: ParsedFile | null;
  children?: React.ReactNode;
}

interface CoverageItem {
  material: string;
  description: string;
  availableStock: number;
  stockCover: number;
  level: "Stock Out" | "Critical" | "Low" | "Good";
}

const LEVEL_BADGE: Record<
  CoverageItem["level"],
  "destructive" | "outline" | "secondary"
> = {
  "Stock Out": "destructive",
  Critical: "outline",
  Low: "outline",
  Good: "secondary",
};

const LEVEL_BORDER: Record<CoverageItem["level"], string> = {
  "Stock Out": "border-red-300",
  Critical: "border-orange-300",
  Low: "border-amber-300",
  Good: "",
};

export function CoveragePopup({ batch, zp40File, children }: CoveragePopupProps) {
  const coverageItems = useMemo<CoverageItem[]>(() => {
    if (!zp40File) return [];

    const headers = zp40File.headers.map((h) => h.toLowerCase().trim());
    const rawHeaders = zp40File.headers;

    const planMatIdx = headers.findIndex(
      (h) => h.includes("planning material") || h.includes("planning mat"),
    );
    const matIdx = headers.findIndex(
      (h) => h === "material" && !h.includes("desc"),
    );
    const descIdx = headers.findIndex(
      (h) => h.includes("material desc") || h.includes("description"),
    );
    const availIdx = headers.findIndex(
      (h) => h.includes("available stock") || h.includes("available"),
    );
    const coverIdx = headers.findIndex(
      (h) => h.includes("stock cover") || h === "cover",
    );

    const bulkCode =
      batch.bulkCode ?? batch.materialCode?.split("-")[0] ?? "";
    const matCode = batch.materialCode ?? "";

    if (!bulkCode && !matCode) return [];

    return zp40File.rows
      .map((row) => {
        const planningMaterial = String(
          row[rawHeaders[planMatIdx >= 0 ? planMatIdx : 0] ?? ""] ?? "",
        );
        const material = String(
          row[rawHeaders[matIdx >= 0 ? matIdx : 1] ?? ""] ?? "",
        );
        const description = String(
          row[rawHeaders[descIdx >= 0 ? descIdx : 2] ?? ""] ?? "",
        );
        const availableStock =
          parseFloat(
            String(row[rawHeaders[availIdx >= 0 ? availIdx : 8] ?? ""] ?? "0"),
          ) || 0;
        const stockCover =
          parseFloat(
            String(
              row[rawHeaders[coverIdx >= 0 ? coverIdx : 10] ?? ""] ?? "0",
            ),
          ) || 0;

        let level: CoverageItem["level"];
        if (stockCover <= 0 || availableStock <= 0) level = "Stock Out";
        else if (stockCover < 15) level = "Critical";
        else if (stockCover < 30) level = "Low";
        else level = "Good";

        return { planningMaterial, material, description, availableStock, stockCover, level };
      })
      .filter(
        (row) =>
          (bulkCode && row.planningMaterial === bulkCode) ||
          (matCode && row.material === matCode) ||
          (bulkCode && row.planningMaterial.includes(bulkCode)),
      )
      .sort((a, b) => {
        const order = { "Stock Out": 0, Critical: 1, Low: 2, Good: 3 };
        return order[a.level] - order[b.level];
      });
  }, [batch, zp40File]);

  if (coverageItems.length === 0) return <>{children}</>;

  // Overall rating = worst level
  const overallLevel = coverageItems[0]!.level;

  return (
    <Popover>
      <PopoverTrigger asChild>
        {children ?? (
          <button
            type="button"
            className="flex items-center gap-1 text-xs hover:underline"
          >
            <BarChart3 className="h-3 w-3" />
            <Badge
              variant={LEVEL_BADGE[overallLevel]}
              className={`text-[10px] ${LEVEL_BORDER[overallLevel]}`}
            >
              {overallLevel}
            </Badge>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" side="right" align="start">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">
              Coverage Profile — {batch.bulkCode ?? batch.materialCode ?? batch.sapOrder}
            </span>
            <Badge
              variant={LEVEL_BADGE[overallLevel]}
              className={`text-[10px] ${LEVEL_BORDER[overallLevel]}`}
            >
              {overallLevel}
            </Badge>
          </div>

          <div className="space-y-1.5">
            {coverageItems.map((item, i) => (
              <div
                key={`${item.material}-${i}`}
                className="flex items-center gap-2 rounded border px-2 py-1 text-xs"
              >
                <Badge
                  variant={LEVEL_BADGE[item.level]}
                  className={`shrink-0 text-[9px] ${LEVEL_BORDER[item.level]}`}
                >
                  {item.level}
                </Badge>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{item.material}</div>
                  <div className="truncate text-muted-foreground">
                    {item.description}
                  </div>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <div>{item.availableStock.toLocaleString()}</div>
                  <div className="text-muted-foreground">
                    {item.stockCover.toFixed(0)}d
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="text-[10px] text-muted-foreground">
            {coverageItems.length} FG material{coverageItems.length !== 1 ? "s" : ""} tracked
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
