import { useCallback, useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  ArrowRight,
  Activity,
  CheckCircle2,
  Bot,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/ui/cn";
import { useUpdateBatch } from "@/hooks/use-batch-mutations";
import { useRecordMovement } from "@/hooks/use-schedule-movements";
import { useCreateDraft } from "@/hooks/use-ai-drafts";
import type { HealthReport, HealthIssue, HealthIssueType } from "@/types/scoring";

/* ------------------------------------------------------------------ */
/*  AI scan report parsing                                             */
/* ------------------------------------------------------------------ */

interface AiScanMessage {
  type: string;
  content: string;
  metadata?: Record<string, unknown> | null;
}

interface ParsedAiAnalysis {
  /** Combined narrative text from Claude's analysis */
  narrative: string;
  /** Structured health report if Claude called score_health */
  healthReport: HealthReport | null;
  /** When the scan was generated */
  generatedAt: string;
}

function parseAiScanReport(raw: unknown): ParsedAiAnalysis | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!r.completed || !Array.isArray(r.messages)) return null;

  const messages = r.messages as AiScanMessage[];

  // Extract narrative from Claude's text messages
  const textChunks = messages
    .filter((m) => m.type === "text" && m.content)
    .map((m) => m.content.trim());
  const narrative = textChunks.join("\n\n");

  // Try to extract a HealthReport from tool_result messages (score_health output)
  let healthReport: HealthReport | null = null;
  for (const msg of messages) {
    if (msg.type !== "tool_result" || !msg.content) continue;
    try {
      const parsed = JSON.parse(msg.content);
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.score === "number" &&
        Array.isArray(parsed.issues) &&
        parsed.issueCounts
      ) {
        healthReport = parsed as HealthReport;
      }
    } catch {
      /* not JSON, skip */
    }
  }

  return {
    narrative,
    healthReport,
    generatedAt: (r.generated_at as string) ?? new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const SEVERITY_CONFIG = {
  critical: {
    icon: AlertCircle,
    colour: "text-red-600",
    bg: "bg-red-50 border-red-200",
    badge: "destructive" as const,
    label: "Critical Issues",
  },
  warning: {
    icon: AlertTriangle,
    colour: "text-yellow-600",
    bg: "bg-yellow-50 border-yellow-200",
    badge: "outline" as const,
    label: "Warnings",
  },
  info: {
    icon: Info,
    colour: "text-blue-600",
    bg: "bg-blue-50 border-blue-200",
    badge: "outline" as const,
    label: "Recommendations",
  },
};

const ISSUE_TYPE_LABELS: Record<HealthIssueType, string> = {
  capacity_overload: "Capacity Overload",
  colour_violation: "Colour Violation",
  wom: "Materials Unavailable",
  wop: "Packaging Unavailable",
  under_utilization: "Under-utilisation",
  unassigned: "Unassigned Batch",
  rule_violation: "Rule Violation",
};

function scoreColourClass(score: number): string {
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-yellow-600";
  if (score >= 40) return "text-orange-600";
  return "text-red-600";
}

/**
 * Determines whether an issue fix is high-impact and should create a draft
 * rather than performing a direct batch move.
 *
 * High-impact criteria:
 * - Critical severity always creates a draft
 * - Warning severity with a resource change creates a draft
 */
function isHighImpact(issue: HealthIssue): boolean {
  if (issue.severity === "critical") return true;

  if (
    issue.severity === "warning" &&
    issue.suggestedAction &&
    issue.resourceId !== issue.suggestedAction.targetResourceId
  ) {
    return true;
  }

  return false;
}

/* ------------------------------------------------------------------ */
/*  Issue row with Apply Fix button                                    */
/* ------------------------------------------------------------------ */

interface IssueRowProps {
  issue: HealthIssue;
  onApplyFix: (issue: HealthIssue) => void;
  onSpotlight?: (batchId: string, targetResourceId?: string | null) => void;
  isApplying: boolean;
  /** Whether this fix will create a draft (shown as hint) */
  willCreateDraft: boolean;
}

function IssueRow({ issue, onApplyFix, onSpotlight, isApplying, willCreateDraft }: IssueRowProps) {
  const cfg = SEVERITY_CONFIG[issue.severity];
  const Icon = cfg.icon;
  const canSpotlight = !!issue.batchId && !!onSpotlight;

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md border p-3",
        cfg.bg,
        canSpotlight && "cursor-pointer hover:ring-2 hover:ring-primary/30 transition-shadow",
      )}
      onClick={() => {
        if (canSpotlight) {
          onSpotlight(issue.batchId, issue.suggestedAction?.targetResourceId ?? null);
        }
      }}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", cfg.colour)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge variant={cfg.badge} className="text-xs">
            {ISSUE_TYPE_LABELS[issue.type]}
          </Badge>
          {canSpotlight && (
            <span className="text-[10px] text-muted-foreground">Click to locate</span>
          )}
        </div>
        <p className="mt-1 text-sm">{issue.message}</p>
        <div className="mt-2 flex items-center gap-2">
          {issue.suggestedAction ? (
            <>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {issue.suggestedAction.description}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-7 text-xs"
                onClick={() => onApplyFix(issue)}
                disabled={isApplying}
              >
                {willCreateDraft ? (
                  <>
                    <FileText className="mr-1 h-3 w-3" />
                    Create Draft
                  </>
                ) : (
                  "Apply Fix"
                )}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-7 text-xs"
              disabled
              title="No automatic fix available"
            >
              Apply Fix
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AI Analysis card (shown when scan report available)                */
/* ------------------------------------------------------------------ */

function AiAnalysisCard({ narrative, generatedAt }: { narrative: string; generatedAt: string }) {
  return (
    <Card className="border-purple-200 bg-purple-50/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Bot className="h-4 w-4 text-purple-600" />
          AI Analysis
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="prose prose-sm max-w-none text-sm text-muted-foreground">
          {narrative.split("\n\n").map((paragraph, idx) => (
            <p key={idx} className="mb-2 last:mb-0">
              {paragraph}
            </p>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          AI scan completed {new Date(generatedAt).toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Metrics card                                                       */
/* ------------------------------------------------------------------ */

function MetricsSection({ report }: { report: HealthReport }) {
  const entries = Object.entries(report.issueCounts).filter(([, v]) => v > 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Metrics</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        <div className="rounded-md border p-3 text-center">
          <div className={cn("text-2xl font-bold", scoreColourClass(report.score))}>
            {report.score}
          </div>
          <div className="text-xs text-muted-foreground">Health Score</div>
        </div>
        <div className="rounded-md border p-3 text-center">
          <div className="text-2xl font-bold">{report.issues.length}</div>
          <div className="text-xs text-muted-foreground">Total Issues</div>
        </div>
        {entries.map(([type, count]) => (
          <div key={type} className="rounded-md border p-3 text-center">
            <div className="text-lg font-semibold">{count}</div>
            <div className="text-xs text-muted-foreground">
              {ISSUE_TYPE_LABELS[type as HealthIssueType]}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Main panel                                                         */
/* ------------------------------------------------------------------ */

interface HealthReportPanelProps {
  /** Deterministic health report from local scoring engine */
  report: HealthReport | null;
  /** Raw ai_scans.report JSON from the latest completed scan */
  aiScanReport?: unknown;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when user clicks an issue to spotlight the batch on the timeline */
  onSpotlightBatch?: (batchId: string, targetResourceId?: string | null) => void;
}

export function HealthReportPanel({
  report,
  aiScanReport,
  open,
  onOpenChange,
  onSpotlightBatch,
}: HealthReportPanelProps) {
  const updateBatch = useUpdateBatch();
  const recordMovement = useRecordMovement();
  const createDraft = useCreateDraft();

  // Parse AI scan report if available
  const aiAnalysis = useMemo(() => parseAiScanReport(aiScanReport), [aiScanReport]);

  // Use AI health report when available, fall back to deterministic
  const effectiveReport = aiAnalysis?.healthReport ?? report;

  const handleSpotlight = useCallback(
    (batchId: string, targetResourceId?: string | null) => {
      onSpotlightBatch?.(batchId, targetResourceId);
      onOpenChange(false); // Close the panel so the timeline is visible
    },
    [onSpotlightBatch, onOpenChange],
  );

  const handleApplyFix = useCallback(
    (issue: HealthIssue) => {
      const action = issue.suggestedAction;
      if (!action) return;

      if (isHighImpact(issue)) {
        // High-impact: create a draft for review instead of direct mutation
        createDraft.mutate(
          {
            draftType: "schedule_change",
            title: `Health fix: ${ISSUE_TYPE_LABELS[issue.type]} — ${issue.batchId}`,
            description: `${issue.message}. Suggested: move to ${action.targetResourceId} on ${action.targetDate} (score ${action.placementScore}).`,
            payload: {
              changes: [
                {
                  batch_id: issue.batchId,
                  plan_resource_id: action.targetResourceId,
                  plan_date: action.targetDate,
                },
              ],
            },
          },
          {
            onSuccess: () => {
              toast.success("Draft created — review in the Drafts panel before applying");
            },
            onError: (err) => {
              toast.error(err instanceof Error ? err.message : "Failed to create draft");
            },
          },
        );
      } else {
        // Low-impact: apply fix directly
        updateBatch.mutate(
          {
            batchId: issue.batchId,
            updates: {
              planResourceId: action.targetResourceId,
              planDate: action.targetDate,
            },
          },
          {
            onSuccess: () => {
              recordMovement.mutate({
                batchId: issue.batchId,
                fromResourceId: issue.resourceId,
                toResourceId: action.targetResourceId,
                fromDate: issue.date,
                toDate: action.targetDate,
                direction: "moved",
                reason: `Health fix: ${issue.message}`,
              });
              toast.success(
                `Batch moved to ${action.targetResourceId} on ${action.targetDate}`,
              );
            },
            onError: (err) => {
              toast.error(err instanceof Error ? err.message : "Failed to apply fix");
            },
          },
        );
      }
    },
    [updateBatch, recordMovement, createDraft],
  );

  if (!effectiveReport) return null;

  const isApplying = updateBatch.isPending || createDraft.isPending;

  const criticalIssues = effectiveReport.issues.filter((i) => i.severity === "critical");
  const warningIssues = effectiveReport.issues.filter((i) => i.severity === "warning");
  const infoIssues = effectiveReport.issues.filter((i) => i.severity === "info");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Schedule Health Report
          </SheetTitle>
          <SheetDescription>
            {aiAnalysis ? "AI-powered analysis" : effectiveReport.summary}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="mt-4 h-[calc(100vh-8rem)]">
          <div className="space-y-6 pr-4">
            {/* AI Analysis narrative (when scan data available) */}
            {aiAnalysis && aiAnalysis.narrative && (
              <AiAnalysisCard
                narrative={aiAnalysis.narrative}
                generatedAt={aiAnalysis.generatedAt}
              />
            )}

            {/* Metrics */}
            <MetricsSection report={effectiveReport} />

            {/* Critical Issues */}
            {criticalIssues.length > 0 && (
              <section>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-red-600">
                  <AlertCircle className="h-4 w-4" />
                  Critical Issues ({criticalIssues.length})
                </h3>
                <div className="space-y-2">
                  {criticalIssues.map((issue, idx) => (
                    <IssueRow
                      key={`${issue.batchId}-${issue.type}-${idx}`}
                      issue={issue}
                      onApplyFix={handleApplyFix}
                      onSpotlight={onSpotlightBatch ? handleSpotlight : undefined}
                      isApplying={isApplying}
                      willCreateDraft={isHighImpact(issue)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Warnings */}
            {warningIssues.length > 0 && (
              <section>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-yellow-600">
                  <AlertTriangle className="h-4 w-4" />
                  Warnings ({warningIssues.length})
                </h3>
                <div className="space-y-2">
                  {warningIssues.map((issue, idx) => (
                    <IssueRow
                      key={`${issue.batchId}-${issue.type}-${idx}`}
                      issue={issue}
                      onApplyFix={handleApplyFix}
                      onSpotlight={onSpotlightBatch ? handleSpotlight : undefined}
                      isApplying={isApplying}
                      willCreateDraft={isHighImpact(issue)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Recommendations (info) */}
            {infoIssues.length > 0 && (
              <section>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-blue-600">
                  <Info className="h-4 w-4" />
                  Recommendations ({infoIssues.length})
                </h3>
                <div className="space-y-2">
                  {infoIssues.map((issue, idx) => (
                    <IssueRow
                      key={`${issue.batchId}-${issue.type}-${idx}`}
                      issue={issue}
                      onApplyFix={handleApplyFix}
                      onSpotlight={onSpotlightBatch ? handleSpotlight : undefined}
                      isApplying={isApplying}
                      willCreateDraft={isHighImpact(issue)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* All clear */}
            {effectiveReport.issues.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <CheckCircle2 className="h-10 w-10 text-green-500" />
                <p className="text-sm font-medium">Schedule is healthy</p>
                <p className="text-xs text-muted-foreground">No issues detected</p>
              </div>
            )}

            {/* Generated at timestamp */}
            <p className="pb-4 text-xs text-muted-foreground">
              {aiAnalysis
                ? `Deterministic baseline: ${effectiveReport.summary}`
                : `Report generated ${new Date(effectiveReport.generatedAt).toLocaleString()}`}
            </p>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
