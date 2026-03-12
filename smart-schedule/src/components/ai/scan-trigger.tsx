import { useState } from "react";
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
} from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import {
  useAiScans,
  useTriggerScan,
  type ScanType,
  type ScanStatus,
} from "@/hooks/use-ai-scans";
import { formatDistanceToNow } from "date-fns";

const SCAN_TYPES: { value: ScanType; label: string; description: string }[] = [
  {
    value: "schedule_optimization",
    label: "Schedule Optimisation",
    description: "Analyse schedule for efficiency improvements",
  },
  {
    value: "rule_analysis",
    label: "Rule Analysis",
    description: "Review substitution and scheduling rules",
  },
  {
    value: "capacity_check",
    label: "Capacity Check",
    description: "Check resource capacity and utilisation",
  },
  {
    value: "full_audit",
    label: "Full Audit",
    description: "Comprehensive analysis of all aspects",
  },
];

const QUICK_ACTIONS: {
  label: string;
  scanType: ScanType;
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
  const [scanType, setScanType] = useState<ScanType>("schedule_optimization");
  const trigger = useTriggerScan();
  const { data: recentScans = [] } = useAiScans(5);

  return (
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
              onValueChange={(v) => setScanType(v as ScanType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCAN_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <span>{t.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => trigger.mutate(scanType)}
            disabled={trigger.isPending}
          >
            {trigger.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Run Scan
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          {SCAN_TYPES.find((t) => t.value === scanType)?.description}
        </p>

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
              <div className="space-y-2">
                {recentScans.map((scan) => (
                  <div
                    key={scan.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2">
                      {statusBadge(scan.status)}
                      <span className="text-muted-foreground">
                        {SCAN_TYPES.find((t) => t.value === scan.scanType)?.label ??
                          scan.scanType}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(scan.createdAt), {
                        addSuffix: true,
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
