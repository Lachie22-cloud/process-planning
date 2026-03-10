import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, AlertTriangle, AlertCircle, Info, Sparkles } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { HealthReportPanel } from "./health-report-panel";
import type { HealthReport } from "@/types/scoring";

/* ------------------------------------------------------------------ */
/*  Score colour helpers                                               */
/* ------------------------------------------------------------------ */

function scoreColour(score: number): string {
  if (score >= 80) return "text-green-700 bg-green-100 border-green-300";
  if (score >= 60) return "text-yellow-700 bg-yellow-100 border-yellow-300";
  if (score >= 40) return "text-orange-700 bg-orange-100 border-orange-300";
  return "text-red-700 bg-red-100 border-red-300";
}

function scoreLabel(score: number): string {
  if (score >= 80) return "Healthy";
  if (score >= 60) return "Fair";
  if (score >= 40) return "Poor";
  return "Critical";
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface ScheduleHealthBarProps {
  report: HealthReport | null;
  isLoading: boolean;
  onRunAnalysis?: () => void;
  isAnalysing?: boolean;
  /** Raw ai_scans.report JSON from the latest completed scan */
  aiScanReport?: unknown;
  /** Called when user clicks an issue to spotlight a batch on the timeline */
  onSpotlightBatch?: (batchId: string, targetResourceId?: string | null) => void;
}

export function ScheduleHealthBar({
  report,
  isLoading,
  onRunAnalysis,
  isAnalysing,
  aiScanReport,
  onSpotlightBatch,
}: ScheduleHealthBarProps) {
  const [panelOpen, setPanelOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-6 w-16" />
        <Skeleton className="h-6 w-16" />
        <Skeleton className="h-6 w-16" />
      </div>
    );
  }

  if (!report) return null;

  const criticalCount = report.issues.filter((i) => i.severity === "critical").length;
  const warningCount = report.issues.filter((i) => i.severity === "warning").length;
  const infoCount = report.issues.filter((i) => i.severity === "info").length;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
        {/* Score badge */}
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors hover:opacity-80",
            scoreColour(report.score),
          )}
        >
          <Activity className="h-4 w-4" />
          {report.score}/100 &middot; {scoreLabel(report.score)}
        </button>

        {/* Issue count pills */}
        {criticalCount > 0 && (
          <Badge
            variant="destructive"
            className="cursor-pointer gap-1"
            onClick={() => setPanelOpen(true)}
          >
            <AlertCircle className="h-3 w-3" />
            {criticalCount} critical
          </Badge>
        )}

        {warningCount > 0 && (
          <Badge
            variant="outline"
            className="cursor-pointer gap-1 border-yellow-400 bg-yellow-50 text-yellow-700"
            onClick={() => setPanelOpen(true)}
          >
            <AlertTriangle className="h-3 w-3" />
            {warningCount} warning{warningCount !== 1 ? "s" : ""}
          </Badge>
        )}

        {infoCount > 0 && (
          <Badge
            variant="outline"
            className="cursor-pointer gap-1 text-muted-foreground"
            onClick={() => setPanelOpen(true)}
          >
            <Info className="h-3 w-3" />
            {infoCount} info
          </Badge>
        )}

        {report.issues.length === 0 && (
          <span className="text-sm text-muted-foreground">No issues detected</span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Run Analysis button */}
        {onRunAnalysis && (
          <Button
            size="sm"
            variant="outline"
            onClick={onRunAnalysis}
            disabled={isAnalysing}
          >
            <Sparkles className="mr-1 h-4 w-4" />
            {isAnalysing ? "Analysing…" : "Run Analysis"}
          </Button>
        )}
      </div>

      {/* Slide-out panel */}
      <HealthReportPanel
        report={report}
        aiScanReport={aiScanReport}
        open={panelOpen}
        onOpenChange={setPanelOpen}
        onSpotlightBatch={onSpotlightBatch}
      />
    </>
  );
}
