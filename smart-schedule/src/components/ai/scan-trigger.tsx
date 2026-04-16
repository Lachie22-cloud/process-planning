import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ScanSearch,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Play,
  Zap,
  ChevronRight,
  Square,
} from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import {
  useAiScans,
  useTriggerScan,
  useCancelScan,
  type ScanStatus,
} from "@/hooks/use-ai-scans";
import { useAiScanTypes } from "@/hooks/use-ai-scan-types";
import { ScanOutputSheet } from "./scan-output-sheet";
import { formatDistanceToNow } from "date-fns";

const QUICK_ACTIONS: {
  label: string;
  scanType: string;
  prompt: string;
}[] = [
  {
    label: "Optimise Week",
    scanType: "schedule_optimization",
    prompt:
      "Analyse the current week's schedule and suggest batch moves that improve efficiency. Focus on reducing colour changeovers, balancing resource utilisation, and consolidating under-utilised days. For each suggestion provide the batch ID, current placement, recommended placement, and expected benefit.",
  },
  {
    label: "Show Issues",
    scanType: "schedule_optimization",
    prompt:
      "Identify all issues in the current schedule: capacity overloads, colour violations, batches waiting on materials or packaging, under-utilised resources, and rule violations. Use score_health to generate a comprehensive health report.",
  },
  {
    label: "Colour Violations",
    scanType: "schedule_optimization",
    prompt:
      "Focus specifically on colour group transitions across all resources. Identify any batches where the colour sequence creates washout problems or violates light-to-dark ordering. Suggest reorderings that minimise colour changeover waste.",
  },
];

function statusBadge(status: ScanStatus) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="outline" className="gap-1">
          <Clock className="h-3 w-3" /> Pending
        </Badge>
      );
    case "running":
      return (
        <Badge variant="default" className="gap-1 bg-blue-600">
          <Loader2 className="h-3 w-3 animate-spin" /> Running
        </Badge>
      );
    case "completed":
      return (
        <Badge variant="default" className="gap-1 bg-emerald-600">
          <CheckCircle2 className="h-3 w-3" /> Completed
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" /> Failed
        </Badge>
      );
    case "cancelled":
      return (
        <Badge variant="secondary" className="gap-1">
          Cancelled
        </Badge>
      );
  }
}

export function ScanTrigger() {
  const { hasPermission } = usePermissions();

  if (!hasPermission("planning.ai")) return null;

  return <ScanTriggerInner />;
}

function ScanTriggerInner() {
  const { data: scanTypes = [] } = useAiScanTypes(true);
  const [scanType, setScanType] = useState<string>("");
  const trigger = useTriggerScan();
  const cancelScan = useCancelScan();
  const { data: recentScans = [] } = useAiScans(5);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);

  // Default to first scan type once loaded
  useEffect(() => {
    const firstScanType = scanTypes[0];
    if (firstScanType && !scanType) {
      setScanType(firstScanType.key);
    }
  }, [scanTypes, scanType]);

  const selectedType = scanTypes.find((t) => t.key === scanType);
  const labelLookup = new Map(scanTypes.map((t) => [t.key, t.label]));

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScanSearch className="h-5 w-5" />
            AI Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Select
                value={scanType}
                onValueChange={(v) => setScanType(v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select scan type..." />
                </SelectTrigger>
                <SelectContent>
                  {scanTypes.map((t) => (
                    <SelectItem key={t.key} value={t.key}>
                      <span>{t.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => trigger.mutate(scanType)}
              disabled={trigger.isPending || !scanType}
            >
              {trigger.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              Run Scan
            </Button>
          </div>

          {selectedType?.description && (
            <p className="text-xs text-muted-foreground">
              {selectedType.description}
            </p>
          )}

          {/* Quick action buttons */}
          <div className="flex flex-wrap gap-2">
            {QUICK_ACTIONS.map((qa) => (
              <Button
                key={qa.label}
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                disabled={trigger.isPending}
                onClick={() =>
                  trigger.mutate({
                    scanType: qa.scanType,
                    promptOverride: qa.prompt,
                  })
                }
              >
                <Zap className="h-3 w-3" />
                {qa.label}
              </Button>
            ))}
          </div>

          {recentScans.length > 0 && (
            <>
              <Separator />
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Recent Scans
                </p>
                <div className="space-y-1">
                  {recentScans.map((scan) => (
                    <div
                      key={scan.id}
                      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/50"
                    >
                      <button
                        type="button"
                        className="flex items-center gap-2 flex-1 min-w-0"
                        onClick={() => setSelectedScanId(scan.id)}
                      >
                        {statusBadge(scan.status)}
                        <span className="text-muted-foreground truncate">
                          {labelLookup.get(scan.scanType) ?? scan.scanType}
                        </span>
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        {(scan.status === "pending" || scan.status === "running") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                            disabled={cancelScan.isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              cancelScan.mutate(scan.id);
                            }}
                          >
                            <Square className="h-3 w-3" />
                          </Button>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(scan.createdAt), {
                            addSuffix: true,
                          })}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedScanId(scan.id)}
                        >
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <ScanOutputSheet
        scanId={selectedScanId}
        onClose={() => setSelectedScanId(null)}
        scanTypeLabels={labelLookup}
      />
    </>
  );
}
