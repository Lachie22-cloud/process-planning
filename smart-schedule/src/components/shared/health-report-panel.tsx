import { useCallback, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  ArrowRight,
  Activity,
  CheckCircle2,
  Bot,
  FileText,
  Crosshair,
  X,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/ui/cn";
import { useUpdateBatch } from "@/hooks/use-batch-mutations";
import { useRecordMovement } from "@/hooks/use-schedule-movements";
import { useCreateDraft } from "@/hooks/use-ai-drafts";
import { useResources } from "@/hooks/use-resources";
import { useBatches } from "@/hooks/use-batches";
import type { AiScan } from "@/hooks/use-ai-scans";
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
  narrative: string;
  healthReport: HealthReport | null;
  generatedAt: string;
}

/** Strip tool-call XML, emoji, UUIDs, and scan progress from narrative */
function cleanNarrative(text: string): string {
  return text
    // Strip emoji unicode ranges
    .replace(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu, "")
    // Strip XML-like tags WITH attributes (e.g. <invoke name="...">, <parameter name="...">)
    .replace(/<\/?[a-z_][a-z_0-9]*(?:\s[^>]*)?\/?>/gi, "")
    // Strip bare UUIDs (with or without surrounding whitespace)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "")
    // Strip scan progress lines (e.g. "scan_schedule_opt_20260310 running 40 ...")
    .replace(/scan_\w+\s+(running|pending|completed)\s*\d*/gi, "")
    // Strip "scheduled YYYY-MM-DD" fragments left over from tool results
    .replace(/\bscheduled\s+\d{4}-\d{2}-\d{2}\b/gi, "")
    // Strip standalone date ranges like "2026-03-10 2026-03-17" on their own
    .replace(/^\s*\d{4}-\d{2}-\d{2}(\s+\d{4}-\d{2}-\d{2})?\s*$/gm, "")
    // Strip lines that are now empty or just whitespace
    .replace(/^\s*$/gm, "")
    // Collapse excessive blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseAiScanReport(raw: unknown): ParsedAiAnalysis | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!r.completed || !Array.isArray(r.messages)) return null;

  const messages = r.messages as AiScanMessage[];

  // Only take genuine text messages (skip tool_use, tool_result, etc.)
  const textChunks = messages
    .filter((m) => m.type === "text" && m.content)
    .map((m) => m.content);
  const narrative = textChunks.join("");

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
/*  UUID resolution helper                                             */
/* ------------------------------------------------------------------ */

type UuidLookup = Map<string, string>;

/** Replace UUIDs in a message string with human-readable names */
function resolveUuids(text: string, lookup: UuidLookup): string {
  return text.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    (uuid) => lookup.get(uuid) ?? uuid,
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const SEVERITY_CONFIG = {
  critical: {
    icon: AlertCircle,
    colour: "text-red-600",
    badge: "destructive" as const,
    label: "Critical Issues",
  },
  warning: {
    icon: AlertTriangle,
    colour: "text-yellow-600",
    badge: "outline" as const,
    label: "Warnings",
  },
  info: {
    icon: Info,
    colour: "text-blue-600",
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
/*  Issue row with action buttons                                      */
/* ------------------------------------------------------------------ */

interface IssueRowProps {
  issue: HealthIssue;
  displayMessage: string;
  displaySuggestion?: string;
  onApplyFix: (issue: HealthIssue) => void;
  onSpotlight?: (batchId: string, targetResourceId?: string | null, targetDate?: string | null) => void;
  isApplying: boolean;
  willCreateDraft: boolean;
  completionState?: "success" | "draft_created" | "error" | null;
}

function IssueRow({
  issue,
  displayMessage,
  displaySuggestion,
  onApplyFix,
  onSpotlight,
  isApplying,
  willCreateDraft,
  completionState,
}: IssueRowProps) {
  const [confirming, setConfirming] = useState(false);
  const cfg = SEVERITY_CONFIG[issue.severity];
  const Icon = cfg.icon;
  const canSpotlight = !!issue.batchId && !!onSpotlight;

  return (
    <div className="flex items-start gap-3 rounded-md border bg-card p-3">
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", cfg.colour)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {ISSUE_TYPE_LABELS[issue.type]}
          </span>

          {canSpotlight && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center justify-center h-5 w-5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSpotlight!(issue.batchId, issue.suggestedAction?.targetResourceId ?? null, issue.date);
                  }}
                  aria-label="Locate batch on timeline"
                >
                  <Crosshair className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Locate on timeline</TooltipContent>
            </Tooltip>
          )}
        </div>

        <p className="mt-1 text-sm">{displayMessage}</p>

        {completionState === "success" && (
          <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-600 animate-in fade-in duration-300">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Batch moved successfully
          </div>
        )}
        {completionState === "draft_created" && (
          <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-blue-600 animate-in fade-in duration-300">
            <FileText className="h-3.5 w-3.5" />
            Draft created — review in AI Drafts below
          </div>
        )}
        {completionState === "error" && (
          <div className="mt-2 text-xs font-medium text-red-600 animate-in fade-in duration-300">
            Action failed — check the error notification
          </div>
        )}

        {!completionState && (
          <div className="mt-2 flex items-center gap-2">
            {issue.suggestedAction ? (
              <>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {displaySuggestion ?? issue.suggestedAction.description}
                </span>

                {!willCreateDraft && confirming ? (
                  <div className="ml-auto flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground">Confirm move?</span>
                    <Button
                      size="sm"
                      variant="default"
                      className="h-6 px-2 text-[10px]"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirming(false);
                        onApplyFix(issue);
                      }}
                      disabled={isApplying}
                    >
                      Yes, move
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirming(false);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto h-7 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (willCreateDraft) {
                        onApplyFix(issue);
                      } else {
                        setConfirming(true);
                      }
                    }}
                    disabled={isApplying}
                  >
                    {willCreateDraft ? (
                      <>
                        <FileText className="mr-1 h-3 w-3" />
                        Create Draft
                      </>
                    ) : (
                      "Move Batch"
                    )}
                  </Button>
                )}
              </>
            ) : (
              <span className="ml-auto text-[10px] text-muted-foreground italic">
                No automatic fix available
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AI Analysis card                                                   */
/* ------------------------------------------------------------------ */

function AiAnalysisCard({ narrative, generatedAt }: { narrative: string; generatedAt: string }) {
  const cleaned = useMemo(() => cleanNarrative(narrative), [narrative]);

  if (!cleaned) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Bot className="h-4 w-4 text-purple-600" />
          AI Analysis
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="prose prose-sm max-w-none text-sm text-muted-foreground [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-medium [&_ul]:mt-1 [&_ol]:mt-1 [&_li]:mt-0.5">
          <ReactMarkdown>{cleaned}</ReactMarkdown>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Scan completed {new Date(generatedAt).toLocaleString()}
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
  report: HealthReport | null;
  /** All completed AI scans (newest first) for history navigation */
  aiScans?: AiScan[];
  /** @deprecated Use aiScans instead — kept for backwards compat */
  aiScanReport?: unknown;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSpotlightBatch?: (batchId: string, targetResourceId?: string | null, targetDate?: string | null) => void;
}

export function HealthReportPanel({
  report,
  aiScans,
  aiScanReport,
  open,
  onOpenChange,
  onSpotlightBatch,
}: HealthReportPanelProps) {
  const updateBatch = useUpdateBatch();
  const recordMovement = useRecordMovement();
  const createDraft = useCreateDraft();
  const { data: resources = [] } = useResources();
  const { data: batches = [] } = useBatches();

  // Track per-issue completion state
  const [completions, setCompletions] = useState<Map<string, "success" | "draft_created" | "error">>(new Map());

  // Scan history navigation (0 = most recent)
  const [scanIndex, setScanIndex] = useState(0);

  // Build completed scans list
  const completedScans = useMemo(() => {
    if (aiScans) return aiScans.filter((s) => s.status === "completed");
    return [];
  }, [aiScans]);

  // Reset to latest when scans change (new scan completes)
  const latestScanId = completedScans[0]?.id;
  const [trackedLatestId, setTrackedLatestId] = useState(latestScanId);
  if (latestScanId !== trackedLatestId) {
    setTrackedLatestId(latestScanId);
    setScanIndex(0);
  }

  // Parse the selected scan
  const selectedScanReport = completedScans[scanIndex]?.report ?? aiScanReport;
  const aiAnalysis = useMemo(() => parseAiScanReport(selectedScanReport), [selectedScanReport]);

  // Use AI health report when available, fall back to deterministic
  const effectiveReport = aiAnalysis?.healthReport ?? report;

  // Build UUID → display name lookup
  const uuidLookup = useMemo<UuidLookup>(() => {
    const map = new Map<string, string>();
    for (const r of resources) {
      map.set(r.id, r.displayName ?? r.resourceCode);
    }
    for (const b of batches) {
      map.set(b.id, b.sapOrder ?? b.id.slice(0, 8));
    }
    return map;
  }, [resources, batches]);

  const handleSpotlight = useCallback(
    (batchId: string, targetResourceId?: string | null, targetDate?: string | null) => {
      onSpotlightBatch?.(batchId, targetResourceId, targetDate);
      onOpenChange(false);
    },
    [onSpotlightBatch, onOpenChange],
  );

  const issueKey = (issue: HealthIssue, idx: number) =>
    `${issue.batchId}-${issue.type}-${idx}`;

  const handleApplyFix = useCallback(
    (issue: HealthIssue, idx: number) => {
      const action = issue.suggestedAction;
      if (!action) return;

      const key = issueKey(issue, idx);

      if (isHighImpact(issue)) {
        const batchName = uuidLookup.get(issue.batchId) ?? issue.batchId;
        const targetName = uuidLookup.get(action.targetResourceId) ?? action.targetResourceId;
        createDraft.mutate(
          {
            draftType: "schedule_change",
            title: `Health fix: ${ISSUE_TYPE_LABELS[issue.type]} \u2014 ${batchName}`,
            description: `${resolveUuids(issue.message, uuidLookup)}. Suggested: move to ${targetName} on ${action.targetDate} (score ${action.placementScore}).`,
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
              setCompletions((prev) => new Map(prev).set(key, "draft_created"));
              toast.success("Draft created \u2014 review in the AI Drafts section below before applying");
            },
            onError: (err) => {
              setCompletions((prev) => new Map(prev).set(key, "error"));
              toast.error(err instanceof Error ? err.message : "Failed to create draft");
            },
          },
        );
      } else {
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
              setCompletions((prev) => new Map(prev).set(key, "success"));
              const targetName = uuidLookup.get(action.targetResourceId) ?? action.targetResourceId;
              toast.success(`Batch moved to ${targetName} on ${action.targetDate}`);
            },
            onError: (err) => {
              setCompletions((prev) => new Map(prev).set(key, "error"));
              toast.error(err instanceof Error ? err.message : "Failed to apply fix");
            },
          },
        );
      }
    },
    [updateBatch, recordMovement, createDraft, uuidLookup],
  );

  // Bulk create drafts for all actionable issues in a severity group
  const [bulkCreating, setBulkCreating] = useState<string | null>(null);
  const handleBulkCreateDrafts = useCallback(
    (issues: HealthIssue[], globalOffset: number) => {
      const actionable = issues.filter((i) => i.suggestedAction);
      if (actionable.length === 0) return;

      const severity = issues[0]?.severity ?? "warning";
      setBulkCreating(severity);

      const changes = actionable.map((issue) => ({
        batch_id: issue.batchId,
        plan_resource_id: issue.suggestedAction!.targetResourceId,
        plan_date: issue.suggestedAction!.targetDate,
      }));

      const description = actionable
        .map((issue) => {
          const batchName = uuidLookup.get(issue.batchId) ?? issue.batchId;
          const targetName = uuidLookup.get(issue.suggestedAction!.targetResourceId) ?? issue.suggestedAction!.targetResourceId;
          return `${batchName} \u2192 ${targetName} on ${issue.suggestedAction!.targetDate}`;
        })
        .join("; ");

      createDraft.mutate(
        {
          draftType: "schedule_change",
          title: `Bulk fix: ${actionable.length} ${severity} issues`,
          description,
          payload: { changes },
        },
        {
          onSuccess: () => {
            setBulkCreating(null);
            // Mark all as draft_created
            setCompletions((prev) => {
              const next = new Map(prev);
              actionable.forEach((issue) => {
                const realIdx = issues.indexOf(issue);
                next.set(issueKey(issue, globalOffset + realIdx), "draft_created");
              });
              return next;
            });
            toast.success(`Draft created for ${actionable.length} issues`);
          },
          onError: (err) => {
            setBulkCreating(null);
            toast.error(err instanceof Error ? err.message : "Failed to create bulk draft");
          },
        },
      );
    },
    [createDraft, uuidLookup],
  );

  if (!effectiveReport) return null;

  const isApplying = updateBatch.isPending || createDraft.isPending;

  const criticalIssues = effectiveReport.issues.filter((i) => i.severity === "critical");
  const warningIssues = effectiveReport.issues.filter((i) => i.severity === "warning");
  const infoIssues = effectiveReport.issues.filter((i) => i.severity === "info");

  const renderIssues = (issues: HealthIssue[], globalOffset: number) =>
    issues.map((issue, idx) => {
      const globalIdx = globalOffset + idx;
      const key = issueKey(issue, globalIdx);
      return (
        <IssueRow
          key={key}
          issue={issue}
          displayMessage={resolveUuids(issue.message, uuidLookup)}
          displaySuggestion={
            issue.suggestedAction
              ? resolveUuids(issue.suggestedAction.description, uuidLookup)
              : undefined
          }
          onApplyFix={(iss) => handleApplyFix(iss, globalIdx)}
          onSpotlight={onSpotlightBatch ? handleSpotlight : undefined}
          isApplying={isApplying}
          willCreateDraft={isHighImpact(issue)}
          completionState={completions.get(key) ?? null}
        />
      );
    });

  const actionableCount = (issues: HealthIssue[]) =>
    issues.filter((i) => i.suggestedAction && !completions.has(issueKey(i, 0))).length;

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

        {/* Scan history navigation */}
        {completedScans.length > 1 && (
          <div className="mt-3 flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
            <span className="text-xs text-muted-foreground flex-1">
              {scanIndex === 0 ? "Latest scan" : `Scan ${scanIndex + 1} of ${completedScans.length}`}
              {completedScans[scanIndex]?.completedAt && (
                <> &middot; {new Date(completedScans[scanIndex].completedAt!).toLocaleString()}</>
              )}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              disabled={scanIndex >= completedScans.length - 1}
              onClick={() => setScanIndex((i) => Math.min(i + 1, completedScans.length - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              disabled={scanIndex <= 0}
              onClick={() => setScanIndex((i) => Math.max(i - 1, 0))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        <ScrollArea className="mt-4 h-[calc(100vh-8rem)]">
          <div className="space-y-6 pr-4">
            {/* AI Analysis narrative */}
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
                <div className="mb-3 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <h3 className="text-sm font-semibold">
                    Critical Issues ({criticalIssues.length})
                  </h3>
                  {actionableCount(criticalIssues) > 1 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto h-7 text-xs"
                      disabled={isApplying || bulkCreating === "critical"}
                      onClick={() => handleBulkCreateDrafts(criticalIssues, 0)}
                    >
                      {bulkCreating === "critical" ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <FileText className="mr-1 h-3 w-3" />
                      )}
                      Create Draft for All
                    </Button>
                  )}
                </div>
                <div className="space-y-2">
                  {renderIssues(criticalIssues, 0)}
                </div>
              </section>
            )}

            {/* Warnings */}
            {warningIssues.length > 0 && (
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-600" />
                  <h3 className="text-sm font-semibold">
                    Warnings ({warningIssues.length})
                  </h3>
                  {actionableCount(warningIssues) > 1 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto h-7 text-xs"
                      disabled={isApplying || bulkCreating === "warning"}
                      onClick={() => handleBulkCreateDrafts(warningIssues, criticalIssues.length)}
                    >
                      {bulkCreating === "warning" ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <FileText className="mr-1 h-3 w-3" />
                      )}
                      Create Draft for All
                    </Button>
                  )}
                </div>
                <div className="space-y-2">
                  {renderIssues(warningIssues, criticalIssues.length)}
                </div>
              </section>
            )}

            {/* Recommendations */}
            {infoIssues.length > 0 && (
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <Info className="h-4 w-4 text-blue-600" />
                  <h3 className="text-sm font-semibold">
                    Recommendations ({infoIssues.length})
                  </h3>
                </div>
                <div className="space-y-2">
                  {renderIssues(infoIssues, criticalIssues.length + warningIssues.length)}
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
