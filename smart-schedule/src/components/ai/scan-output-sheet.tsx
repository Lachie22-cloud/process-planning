import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Bot,
} from "lucide-react";
import { useAiScan } from "@/hooks/use-ai-scans";
import { cn } from "@/lib/ui/cn";
import type { HealthReport, HealthIssueType } from "@/types/scoring";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AiScanMessage {
  type: string;
  content: string;
  metadata?: Record<string, unknown> | null;
}

interface ParsedReport {
  narrative: string;
  healthReport: HealthReport | null;
  generatedAt: string;
}

/* ------------------------------------------------------------------ */
/*  Parsing helpers (aligned with health-report-panel.tsx)              */
/* ------------------------------------------------------------------ */

function cleanNarrative(text: string): string {
  return text
    // Strip emojis
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "")
    // Strip XML tags (tool calls like <get_batches>, <invoke name="...">)
    .replace(/<\/?[a-z_][a-z_0-9]*(?:\s[^>]*)?\/?>/gi, "")
    // Strip UUIDs
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "")
    // Strip scan status/progress lines ("running 10", "running 50 Analysing...")
    .replace(/scan_\w+\s+(running|pending|completed)\s*\d*/gi, "")
    .replace(/^\s*(running|pending|completed)\s+\d+.*$/gm, "")
    // Strip bare status words on their own line
    .replace(/^\s*(Planned|running|pending|completed)\s*$/gm, "")
    // Strip bare numbers on their own line
    .replace(/^\s*\d+\s*$/gm, "")
    // Strip "mixer false/true" lines
    .replace(/^\s*mixer\s+(true|false)\s*$/gm, "")
    // Strip bare dates
    .replace(/\bscheduled\s+\d{4}-\d{2}-\d{2}\b/gi, "")
    .replace(/^\s*\d{4}-\d{2}-\d{2}(\s+(to\s+)?\d{4}-\d{2}-\d{2})?\s*$/gm, "")
    .replace(/^\s*\d{2}\/\d{2}\/\d{4}(\s+(to\s+)?\d{2}\/\d{2}\/\d{4})?\s*$/gm, "")
    // Strip AI reasoning/thinking phrases (common patterns)
    .replace(/^(?:Let me|I'll|I will|Now let me|Now I'll|First,? (?:let me|I'll)|Starting schedule)[^.]*[.:]\s*/gm, "")
    // Strip "Step N:" headers that are just planning
    .replace(/^##?\s*Step\s+\d+[^#\n]*/gm, "")
    // Strip progress messages
    .replace(/^\s*(?:Starting|Analysing|Identifying|Generating)\s+.*$/gm, "")
    // Clean up empty lines
    .replace(/^\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Extract structured sections from the AI narrative */
function extractSections(narrative: string): {
  critical: string | null;
  warnings: string | null;
  opportunities: string | null;
  summary: string | null;
  remainder: string;
} {
  const result = {
    critical: null as string | null,
    warnings: null as string | null,
    opportunities: null as string | null,
    summary: null as string | null,
    remainder: narrative,
  };

  // Match markdown headings: ### Critical Issues, ### Warnings, ### Opportunities, ### Summary
  const sectionPattern = /###\s+(Critical Issues|Warnings|Opportunities|Summary)\s*\n([\s\S]*?)(?=###\s+(?:Critical Issues|Warnings|Opportunities|Summary)|$)/gi;
  let match: RegExpExecArray | null;
  const matchedRanges: Array<[number, number]> = [];

  while ((match = sectionPattern.exec(narrative)) !== null) {
    const heading = (match[1] ?? "").toLowerCase();
    const content = (match[2] ?? "").trim();
    matchedRanges.push([match.index, match.index + match[0].length]);

    if (heading === "critical issues") result.critical = content;
    else if (heading === "warnings") result.warnings = content;
    else if (heading === "opportunities") result.opportunities = content;
    else if (heading === "summary") result.summary = content;
  }

  // Build remainder from unmatched portions
  if (matchedRanges.length > 0) {
    let remainder = "";
    let lastEnd = 0;
    for (const [start, end] of matchedRanges) {
      remainder += narrative.slice(lastEnd, start);
      lastEnd = end;
    }
    const lastRange = matchedRanges[matchedRanges.length - 1]!;
    remainder += narrative.slice(lastRange[1]);
    result.remainder = remainder.replace(/\n{3,}/g, "\n\n").trim();
  }

  return result;
}

function parseReport(raw: unknown): ParsedReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.messages)) return null;

  const messages = r.messages as AiScanMessage[];

  // Deduplicate text: if we have many tiny fragments, they're stream deltas.
  // If we also have larger text blocks (assistant), prefer those.
  const textMsgs = messages.filter((m) => m.type === "text" && m.content);
  const hasLargeBlocks = textMsgs.some((m) => m.content.length > 200);

  let narrative: string;
  if (hasLargeBlocks) {
    // Use only the large blocks (full assistant responses), skip tiny stream deltas
    narrative = textMsgs
      .filter((m) => m.content.length > 50)
      .map((m) => m.content)
      .join("\n\n");
  } else {
    // All fragments — join them (likely all stream deltas)
    narrative = textMsgs.map((m) => m.content).join("");
  }

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
      /* not JSON */
    }
  }

  return {
    narrative,
    healthReport,
    generatedAt: (r.generated_at as string) ?? new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/*  Severity config                                                    */
/* ------------------------------------------------------------------ */

const SEVERITY_CONFIG = {
  critical: {
    icon: AlertCircle,
    colour: "text-red-500",
    label: "Critical Issues",
  },
  warning: {
    icon: AlertTriangle,
    colour: "text-yellow-500",
    label: "Warnings",
  },
  info: {
    icon: Info,
    colour: "text-blue-500",
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

function getSeverityCounts(report: HealthReport) {
  return report.issues.reduce(
    (counts, issue) => {
      counts[issue.severity] += 1;
      return counts;
    },
    { critical: 0, warning: 0, info: 0 },
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface ScanOutputSheetProps {
  scanId: string | null;
  onClose: () => void;
  scanTypeLabels: Map<string, string>;
}

export function ScanOutputSheet({
  scanId,
  onClose,
  scanTypeLabels,
}: ScanOutputSheetProps) {
  const { data: scan } = useAiScan(scanId);

  const parsed = useMemo(
    () => (scan ? parseReport(scan.report) : null),
    [scan],
  );

  const cleanedNarrative = useMemo(
    () => (parsed?.narrative ? cleanNarrative(parsed.narrative) : ""),
    [parsed],
  );

  const sections = useMemo(
    () => (cleanedNarrative ? extractSections(cleanedNarrative) : null),
    [cleanedNarrative],
  );

  const issuesByLevel = useMemo(() => {
    if (!parsed?.healthReport?.issues) return null;
    const issues = parsed.healthReport.issues;
    const groups = {
      critical: [] as typeof issues,
      warning: [] as typeof issues,
      info: [] as typeof issues,
    };
    for (const issue of issues) {
      const sev = issue.severity as keyof typeof groups;
      if (groups[sev]) groups[sev].push(issue);
    }
    return groups;
  }, [parsed]);

  const severityCounts = useMemo(
    () => (parsed?.healthReport ? getSeverityCounts(parsed.healthReport) : null),
    [parsed],
  );

  const isInProgress = scan?.status === "pending" || scan?.status === "running";
  const isFailed = scan?.status === "failed";

  return (
    <Sheet open={!!scanId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="sm:max-w-2xl p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Scan Report
          </SheetTitle>
          {scan && (
            <SheetDescription className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={scan.status} />
              <span>{scanTypeLabels.get(scan.scanType) ?? scan.scanType}</span>
              <span className="text-muted-foreground">
                {new Date(scan.createdAt).toLocaleString()}
              </span>
            </SheetDescription>
          )}
        </SheetHeader>

        <ScrollArea className="flex-1 px-6 pb-16">
          <div className="space-y-6 py-4">
            {/* Loading state */}
            {!scan && scanId && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* In progress */}
            {isInProgress && (
              <div className="flex flex-col items-center justify-center gap-3 py-12">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                <p className="text-sm text-muted-foreground">
                  Scan is in progress — results will appear when complete.
                </p>
              </div>
            )}

            {/* Failed state */}
            {isFailed && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <div className="flex items-start gap-3">
                  <XCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-sm">Scan Failed</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {scan?.errorMessage ?? "An unknown error occurred during the scan."}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Health score summary */}
            {parsed?.healthReport && (
              <div className="rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Health Score</p>
                  <span className={cn("text-2xl font-bold", scoreColourClass(parsed.healthReport.score))}>
                    {parsed.healthReport.score}
                    <span className="text-sm font-normal text-muted-foreground">/100</span>
                  </span>
                </div>
                {severityCounts && (
                  <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                    <span>{severityCounts.critical} critical</span>
                    <span>{severityCounts.warning} warnings</span>
                    <span>{severityCounts.info} recommendations</span>
                  </div>
                )}
              </div>
            )}

            {/* Structured AI sections — shown when the AI outputs the expected headings */}
            {sections && (sections.critical || sections.warnings || sections.opportunities || sections.summary) && !isInProgress && (
              <div className="space-y-5">
                {/* Critical Issues */}
                {sections.critical && sections.critical.toLowerCase() !== "no critical issues found." && (
                  <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-card p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertCircle className="h-4 w-4 text-red-500" />
                      <p className="text-sm font-semibold text-red-700 dark:text-red-400">Critical Issues</p>
                    </div>
                    <div className="prose prose-sm max-w-none text-foreground dark:prose-invert">
                      <ReactMarkdown>{sections.critical}</ReactMarkdown>
                    </div>
                  </div>
                )}
                {sections.critical && sections.critical.toLowerCase() === "no critical issues found." && (
                  <div className="rounded-lg border border-green-200 dark:border-green-900/50 bg-card p-4">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <p className="text-sm font-medium text-green-700 dark:text-green-400">No critical issues</p>
                    </div>
                  </div>
                )}

                {/* Warnings */}
                {sections.warnings && sections.warnings.toLowerCase() !== "no warnings." && (
                  <div className="rounded-lg border border-yellow-200 dark:border-yellow-900/50 bg-card p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertTriangle className="h-4 w-4 text-yellow-500" />
                      <p className="text-sm font-semibold text-yellow-700 dark:text-yellow-400">Warnings</p>
                    </div>
                    <div className="prose prose-sm max-w-none text-foreground dark:prose-invert">
                      <ReactMarkdown>{sections.warnings}</ReactMarkdown>
                    </div>
                  </div>
                )}

                {/* Opportunities */}
                {sections.opportunities && sections.opportunities.toLowerCase() !== "no opportunities identified." && (
                  <div className="rounded-lg border border-blue-200 dark:border-blue-900/50 bg-card p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Info className="h-4 w-4 text-blue-500" />
                      <p className="text-sm font-semibold text-blue-700 dark:text-blue-400">Opportunities</p>
                    </div>
                    <div className="prose prose-sm max-w-none text-foreground dark:prose-invert">
                      <ReactMarkdown>{sections.opportunities}</ReactMarkdown>
                    </div>
                  </div>
                )}

                {/* Summary */}
                {sections.summary && (
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <p className="text-sm font-semibold mb-2">Summary</p>
                    <div className="prose prose-sm max-w-none text-muted-foreground dark:prose-invert">
                      <ReactMarkdown>{sections.summary}</ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Issues by severity (from deterministic health scorer) */}
            {issuesByLevel && (
              <div className="space-y-4">
                <p className="text-sm font-semibold">Detailed Health Issues</p>
                {(["critical", "warning", "info"] as const).map((level) => {
                  const issues = issuesByLevel[level];
                  if (!issues || issues.length === 0) return null;
                  const config = SEVERITY_CONFIG[level];
                  const Icon = config.icon;
                  return (
                    <div key={level}>
                      <div className="flex items-center gap-2 mb-2">
                        <Icon className={cn("h-4 w-4", config.colour)} />
                        <p className="text-sm font-medium">{config.label}</p>
                        <Badge variant="outline" className="text-xs">
                          {issues.length}
                        </Badge>
                      </div>
                      <div className="space-y-2">
                        {issues.map((issue, i) => (
                          <div
                            key={i}
                            className="rounded-md border p-3 text-sm"
                          >
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {ISSUE_TYPE_LABELS[issue.type] ?? issue.type}
                              </Badge>
                            </div>
                            <p className="mt-1 text-muted-foreground">
                              {issue.message}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Fallback: unstructured AI narrative (only if no structured sections found) */}
            {cleanedNarrative && !isInProgress && !(sections?.critical || sections?.warnings || sections?.opportunities || sections?.summary) && (
              <div>
                <p className="text-sm font-medium mb-2">AI Analysis</p>
                <div className="prose prose-sm max-w-none text-muted-foreground dark:prose-invert">
                  <ReactMarkdown>{cleanedNarrative}</ReactMarkdown>
                </div>
              </div>
            )}

            {/* Any remaining narrative not captured by structured sections */}
            {sections?.remainder && !isInProgress && (sections.critical || sections.warnings || sections.opportunities || sections.summary) && (
              <div>
                <p className="text-sm font-medium mb-2">Additional Notes</p>
                <div className="prose prose-sm max-w-none text-muted-foreground dark:prose-invert">
                  <ReactMarkdown>{sections.remainder}</ReactMarkdown>
                </div>
              </div>
            )}

            {/* Empty completed state */}
            {scan?.status === "completed" && !cleanedNarrative && !parsed?.healthReport && (
              <div className="flex flex-col items-center justify-center gap-2 py-12">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                <p className="text-sm text-muted-foreground">
                  Scan completed but no report data was generated.
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Status badge (reused from scan-trigger)                            */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: string }) {
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
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
