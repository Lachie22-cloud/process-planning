import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowRight, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { Resource } from "@/types/resource";
import type { SubstitutionRule, SubstitutionConditions } from "@/types/rule";
import type { SubstitutionGenerationConfig } from "@/lib/validators/substitution-generation-settings";
import {
  generateSubstitutionRules,
  type CandidateRule,
  type GenerationResult,
} from "@/lib/utils/rule-generation";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatConditions(conditions: SubstitutionConditions | null): string {
  if (!conditions) return "None";
  const parts: string[] = [];
  if (conditions.maxVolume != null) {
    parts.push(`Max: ${conditions.maxVolume.toLocaleString()}L`);
  }
  if (conditions.minVolume != null) {
    parts.push(`Min: ${conditions.minVolume.toLocaleString()}L`);
  }
  if (conditions.colorGroups?.length) {
    parts.push(`Colours: ${conditions.colorGroups.join(", ")}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "None";
}

const STATUS_LABELS: Record<CandidateRule["duplicateStatus"], string> = {
  new: "New",
  skipped: "Skipped",
  upsert: "Update",
  created_disabled: "Disabled",
};

const STATUS_VARIANTS: Record<
  CandidateRule["duplicateStatus"],
  "default" | "secondary" | "outline" | "destructive"
> = {
  new: "default",
  skipped: "secondary",
  upsert: "outline",
  created_disabled: "secondary",
};

interface GroupedCandidates {
  groupName: string;
  candidates: CandidateRule[];
}

function groupCandidatesByResourceGroup(
  candidates: CandidateRule[],
  resourceMap: Map<string, Resource>,
): GroupedCandidates[] {
  const groups = new Map<string, CandidateRule[]>();

  for (const candidate of candidates) {
    const source = resourceMap.get(candidate.sourceResourceId);
    const groupName = source?.groupName ?? "Ungrouped";
    const existing = groups.get(groupName);
    if (existing) {
      existing.push(candidate);
    } else {
      groups.set(groupName, [candidate]);
    }
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([groupName, groupCandidates]) => ({
      groupName,
      candidates: groupCandidates,
    }));
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface GenerateRulesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resources: Resource[];
  existingRules: SubstitutionRule[];
  config: SubstitutionGenerationConfig;
  isPending: boolean;
  onGenerate: (candidates: CandidateRule[]) => void;
}

export function GenerateRulesDialog({
  open,
  onOpenChange,
  resources,
  existingRules,
  config,
  isPending,
  onGenerate,
}: GenerateRulesDialogProps) {
  const resourceMap = useMemo(
    () => new Map(resources.map((r) => [r.id, r])),
    [resources],
  );

  const result: GenerationResult = useMemo(
    () => generateSubstitutionRules(resources, config, existingRules),
    [resources, config, existingRules],
  );

  const actionable = useMemo(
    () => result.candidates.filter((c) => c.duplicateStatus !== "skipped"),
    [result.candidates],
  );

  const grouped = useMemo(
    () => groupCandidatesByResourceGroup(result.candidates, resourceMap),
    [result.candidates, resourceMap],
  );

  // Summary counts
  const counts = useMemo(() => {
    const map: Record<CandidateRule["duplicateStatus"], number> = {
      new: 0,
      skipped: 0,
      upsert: 0,
      created_disabled: 0,
    };
    for (const c of result.candidates) {
      map[c.duplicateStatus]++;
    }
    return map;
  }, [result.candidates]);

  const [showSkipped, setShowSkipped] = useState(false);

  function handleGenerate() {
    onGenerate(actionable);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Generate Substitution Rules</DialogTitle>
          <DialogDescription>
            Preview the rules that will be created based on your current
            generation settings. Review the pairs below before confirming.
          </DialogDescription>
        </DialogHeader>

        {/* Summary counts */}
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/50 px-4 py-3 text-sm">
          <span className="font-medium">
            {result.totalPairsEvaluated} pair{result.totalPairsEvaluated === 1 ? "" : "s"} evaluated
          </span>
          <span className="text-muted-foreground">·</span>
          {counts.new > 0 && (
            <Badge variant="default">{counts.new} new</Badge>
          )}
          {counts.upsert > 0 && (
            <Badge variant="outline">{counts.upsert} to update</Badge>
          )}
          {counts.created_disabled > 0 && (
            <Badge variant="secondary">
              {counts.created_disabled} as disabled
            </Badge>
          )}
          {counts.skipped > 0 && (
            <Badge variant="secondary">{counts.skipped} skipped</Badge>
          )}
        </div>

        {/* Skipped toggle */}
        {counts.skipped > 0 && (
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => setShowSkipped((prev) => !prev)}
          >
            {showSkipped ? "Hide" : "Show"} {counts.skipped} skipped duplicate{counts.skipped === 1 ? "" : "s"}
          </Button>
        )}

        {/* Preview table */}
        {result.candidates.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
            <AlertTriangle className="h-8 w-8" />
            <p className="text-sm">
              No candidate rules were generated. Adjust the generation settings
              to broaden the scope or eligibility criteria.
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead />
                  <TableHead>Target</TableHead>
                  <TableHead>Conditions</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grouped.map((group) => {
                  const visibleCandidates = showSkipped
                    ? group.candidates
                    : group.candidates.filter((c) => c.duplicateStatus !== "skipped");

                  if (visibleCandidates.length === 0) return null;

                  return (
                    <GroupRows
                      key={group.groupName}
                      groupName={group.groupName}
                      candidates={visibleCandidates}
                      resourceMap={resourceMap}
                    />
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={isPending || actionable.length === 0}
          >
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            Generate {actionable.length} Rule{actionable.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Group rows                                                         */
/* ------------------------------------------------------------------ */

interface GroupRowsProps {
  groupName: string;
  candidates: CandidateRule[];
  resourceMap: Map<string, Resource>;
}

function GroupRows({ groupName, candidates, resourceMap }: GroupRowsProps) {
  return (
    <>
      <TableRow className="bg-muted/30 hover:bg-muted/30">
        <TableCell colSpan={5} className="py-1.5 text-xs font-semibold text-muted-foreground">
          {groupName} ({candidates.length})
        </TableCell>
      </TableRow>
      {candidates.map((candidate, idx) => {
        const source = resourceMap.get(candidate.sourceResourceId);
        const target = resourceMap.get(candidate.targetResourceId);
        return (
          <TableRow
            key={`${candidate.sourceResourceId}-${candidate.targetResourceId}-${idx}`}
            className={candidate.duplicateStatus === "skipped" ? "opacity-50" : undefined}
          >
            <TableCell className="text-sm font-medium">
              {source?.displayName ?? source?.resourceCode ?? "Unknown"}
            </TableCell>
            <TableCell>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </TableCell>
            <TableCell className="text-sm font-medium">
              {target?.displayName ?? target?.resourceCode ?? "Unknown"}
            </TableCell>
            <TableCell className="max-w-[180px] truncate text-xs text-muted-foreground">
              {formatConditions(candidate.conditions)}
            </TableCell>
            <TableCell>
              <Badge
                variant={STATUS_VARIANTS[candidate.duplicateStatus]}
                className="text-[10px]"
              >
                {STATUS_LABELS[candidate.duplicateStatus]}
              </Badge>
            </TableCell>
          </TableRow>
        );
      })}
    </>
  );
}
