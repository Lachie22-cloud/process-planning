import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  FileCheck,
  CheckCircle2,
  XCircle,
  Play,
  Clock,
  Loader2,
  Sparkles,
  Crosshair,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Trash2,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { formatDistanceToNow } from "date-fns";
import { usePermissions } from "@/hooks/use-permissions";
import { useResources } from "@/hooks/use-resources";
import { useBatches } from "@/hooks/use-batches";
import { useSpotlight } from "@/contexts/spotlight-context";
import {
  useAiDrafts,
  useApproveDraft,
  useRejectDraft,
  useApplyDraft,
  usePurgeDrafts,
  type AiDraft,
  type DraftStatus,
} from "@/hooks/use-ai-drafts";

const DRAFT_TYPE_LABELS: Record<string, string> = {
  schedule_change: "Schedule Change",
  rule_suggestion: "Rule Suggestion",
  resource_rebalance: "Resource Rebalance",
};

function draftStatusBadge(status: DraftStatus) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="outline" className="gap-1">
          <Clock className="h-3 w-3" /> Pending
        </Badge>
      );
    case "approved":
      return (
        <Badge variant="default" className="gap-1 bg-emerald-600">
          <CheckCircle2 className="h-3 w-3" /> Approved
        </Badge>
      );
    case "rejected":
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" /> Rejected
        </Badge>
      );
    case "applied":
      return (
        <Badge variant="default" className="gap-1 bg-blue-600">
          <Play className="h-3 w-3" /> Applied
        </Badge>
      );
  }
}

/** Format ISO date as DD/MM/YYYY */
function formatDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "dd/MM/yyyy");
  } catch {
    return dateStr;
  }
}

export function DraftReviewPanel({ compactMode = false }: { compactMode?: boolean } = {}) {
  const { hasPermission } = usePermissions();
  const canViewDrafts = hasPermission("planning.ai");
  const canVet = hasPermission("planning.vet");

  const { data: drafts = [], isLoading } = useAiDrafts();
  const purgeDrafts = usePurgeDrafts();
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);

  if (!canViewDrafts) return null;

  const pendingDrafts = drafts.filter((d) => d.status === "pending");
  const otherDrafts = drafts.filter((d) => d.status !== "pending");

  // In compact mode, hide entirely when there are no pending drafts
  if (compactMode && pendingDrafts.length === 0) return null;

  // Build full ordered list for prev/next navigation
  const orderedDrafts = [...pendingDrafts, ...otherDrafts];

  const handleSelect = (draft: AiDraft) => {
    const idx = orderedDrafts.findIndex((d) => d.id === draft.id);
    setSelectedIdx(idx >= 0 ? idx : null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-5 w-5" />
          AI Drafts
          {pendingDrafts.length > 0 && (
            <Badge variant="secondary">
              {pendingDrafts.length} pending
            </Badge>
          )}
          {drafts.length > 0 && (
            <div className="ml-auto">
              {confirmPurge ? (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground mr-1">Delete all?</span>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 px-2 text-xs"
                    disabled={purgeDrafts.isPending}
                    onClick={() => {
                      purgeDrafts.mutate(undefined, {
                        onSuccess: () => setConfirmPurge(false),
                      });
                    }}
                  >
                    {purgeDrafts.isPending ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="mr-1 h-3 w-3" />
                    )}
                    Confirm
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => setConfirmPurge(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  onClick={() => setConfirmPurge(true)}
                >
                  <Trash2 className="mr-1 h-3 w-3" />
                  Purge All
                </Button>
              )}
            </div>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : drafts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No AI-generated drafts yet. Trigger a scan to generate suggestions.
          </p>
        ) : (
          <div className="space-y-4">
            {pendingDrafts.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Pending Review
                </p>
                <div className="space-y-2">
                  {pendingDrafts.map((draft) => (
                    <DraftCard
                      key={draft.id}
                      draft={draft}
                      canVet={canVet}
                      onSelect={() => handleSelect(draft)}
                    />
                  ))}
                </div>
              </div>
            )}
            {otherDrafts.length > 0 && (
              <>
                {pendingDrafts.length > 0 && <Separator />}
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    Reviewed
                  </p>
                  <div className="space-y-2">
                    {otherDrafts.slice(0, 10).map((draft) => (
                      <DraftCard
                        key={draft.id}
                        draft={draft}
                        canVet={canVet}
                        onSelect={() => handleSelect(draft)}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>

      {selectedIdx !== null && orderedDrafts[selectedIdx] && (
        <DraftDetailDialog
          draft={orderedDrafts[selectedIdx]}
          canVet={canVet}
          currentIndex={selectedIdx}
          totalCount={orderedDrafts.length}
          onNavigate={setSelectedIdx}
          onClose={() => setSelectedIdx(null)}
        />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Draft Card                                                         */
/* ------------------------------------------------------------------ */

function DraftCard({
  draft,
  canVet,
  onSelect,
}: {
  draft: AiDraft;
  canVet: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{draft.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {DRAFT_TYPE_LABELS[draft.draftType] ?? draft.draftType}
            {" \u00b7 "}
            {formatDistanceToNow(new Date(draft.createdAt), { addSuffix: true })}
          </p>
        </div>
        <div className="shrink-0">{draftStatusBadge(draft.status)}</div>
      </div>
      {draft.description && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {draft.description}
        </p>
      )}
      {draft.status === "pending" && !canVet && (
        <p className="mt-1 text-xs text-amber-600">
          Requires planning.vet permission to review
        </p>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Human-readable change summary                                      */
/* ------------------------------------------------------------------ */

interface ScheduleChange {
  batch_id: string;
  plan_resource_id?: string;
  plan_date?: string;
  plan_disperser_id?: string;
  plan_disperser2_id?: string;
}

function ChangesSummary({
  payload,
  onSpotlight,
}: {
  payload: unknown;
  onSpotlight: (batchId: string, resourceId?: string, date?: string) => void;
}) {
  const { data: resources = [] } = useResources();
  const { data: batches = [] } = useBatches();

  const resourceMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of resources) {
      map.set(r.id, r.displayName ?? r.resourceCode);
    }
    return map;
  }, [resources]);

  const batchMap = useMemo(() => {
    const map = new Map<string, { sapOrder: string; description: string | null; currentResource: string | null; currentDate: string | null; disperser1: string | null; disperser2: string | null }>();
    for (const b of batches) {
      map.set(b.id, {
        sapOrder: b.sapOrder,
        description: b.materialDescription,
        currentResource: b.planResourceId,
        currentDate: b.planDate,
        disperser1: b.planDisperserId,
        disperser2: b.planDisperser2Id,
      });
    }
    return map;
  }, [batches]);

  // Parse changes from payload
  const changes: ScheduleChange[] = useMemo(() => {
    if (!payload || typeof payload !== "object") return [];
    const p = payload as Record<string, unknown>;
    if (Array.isArray(p.changes)) return p.changes as ScheduleChange[];
    return [];
  }, [payload]);

  if (changes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No schedule changes in this draft.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground">
        Proposed Changes ({changes.length})
      </p>
      {changes.map((change, i) => {
        const batch = batchMap.get(change.batch_id);
        const targetResource = change.plan_resource_id
          ? resourceMap.get(change.plan_resource_id) ?? change.plan_resource_id
          : null;
        const currentResource = batch?.currentResource
          ? resourceMap.get(batch.currentResource) ?? batch.currentResource
          : "Unassigned";
        const disperser1Label = batch?.disperser1
          ? resourceMap.get(batch.disperser1) ?? null
          : null;
        const disperser2Label = batch?.disperser2
          ? resourceMap.get(batch.disperser2) ?? null
          : null;
        const disperserSuffix = [disperser1Label, disperser2Label].filter(Boolean).join(", ");

        return (
          <div
            key={i}
            className="rounded-md border bg-muted/30 p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {batch?.sapOrder ?? "Unknown batch"}
                </p>
                {batch?.description && (
                  <p className="text-xs text-muted-foreground truncate">
                    {batch.description}
                  </p>
                )}
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 shrink-0"
                    onClick={() => onSpotlight(change.batch_id, change.plan_resource_id, batch?.currentDate ?? change.plan_date)}
                  >
                    <Crosshair className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Locate on timeline</TooltipContent>
              </Tooltip>
            </div>

            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="rounded bg-muted px-2 py-0.5">
                {currentResource}
                {disperserSuffix ? ` + ${disperserSuffix}` : ""}
                {batch?.currentDate ? ` \u00b7 ${formatDate(batch.currentDate)}` : ""}
              </span>
              <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="rounded bg-primary/10 text-primary px-2 py-0.5 font-medium">
                {targetResource ?? "Same resource"}
                {disperserSuffix ? ` + ${disperserSuffix}` : ""}
                {change.plan_date ? ` \u00b7 ${formatDate(change.plan_date)}` : ""}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Draft Detail Dialog                                                */
/* ------------------------------------------------------------------ */

function DraftDetailDialog({
  draft,
  canVet,
  currentIndex,
  totalCount,
  onNavigate,
  onClose,
}: {
  draft: AiDraft;
  canVet: boolean;
  currentIndex: number;
  totalCount: number;
  onNavigate: (idx: number) => void;
  onClose: () => void;
}) {
  const [comment, setComment] = useState("");
  const approve = useApproveDraft();
  const reject = useRejectDraft();
  const apply = useApplyDraft();
  const { spotlightBatch } = useSpotlight();

  const isPending = draft.status === "pending";
  const isApproved = draft.status === "approved";
  const isActing = approve.isPending || reject.isPending || apply.isPending;

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < totalCount - 1;

  const handleApprove = () => {
    approve.mutate(
      { draftId: draft.id, comment: comment || undefined },
      {
        onSuccess: () => {
          // Auto-apply after approval so the change takes effect immediately
          apply.mutate(draft.id, { onSuccess: onClose });
        },
      },
    );
  };

  const handleReject = () => {
    if (!comment.trim()) return;
    reject.mutate(
      { draftId: draft.id, comment },
      { onSuccess: onClose },
    );
  };

  const handleApply = () => {
    apply.mutate(draft.id, { onSuccess: onClose });
  };

  const handleSpotlight = (batchId: string, resourceId?: string, date?: string) => {
    spotlightBatch(batchId, resourceId ?? null, date ?? null);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileCheck className="h-5 w-5" />
              Draft Review
            </DialogTitle>
            {/* Navigation */}
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-xs text-muted-foreground tabular-nums">
                {currentIndex + 1} / {totalCount}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                disabled={!hasPrev}
                onClick={() => onNavigate(currentIndex - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                disabled={!hasNext}
                onClick={() => onNavigate(currentIndex + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <DialogDescription className="flex items-center gap-2">
            {DRAFT_TYPE_LABELS[draft.draftType] ?? draft.draftType}
            {" \u00b7 "}
            {draftStatusBadge(draft.status)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {draft.description && (
            <p className="text-sm text-muted-foreground">{draft.description}</p>
          )}

          {/* Human-readable changes */}
          <TooltipProvider>
            <ChangesSummary
              payload={draft.payload}
              onSpotlight={handleSpotlight}
            />
          </TooltipProvider>

          {/* Review info */}
          {draft.reviewedBy && (
            <div className="rounded-md bg-muted/50 p-3 text-xs">
              <p>
                <strong>Reviewed by:</strong> {draft.reviewedBy}
              </p>
              {draft.reviewedAt && (
                <p>
                  <strong>At:</strong>{" "}
                  {new Date(draft.reviewedAt).toLocaleString()}
                </p>
              )}
              {draft.reviewComment && (
                <p>
                  <strong>Comment:</strong> {draft.reviewComment}
                </p>
              )}
            </div>
          )}

          {draft.appliedBy && (
            <div className="rounded-md bg-blue-50 p-3 text-xs dark:bg-blue-950">
              <p>
                <strong>Applied by:</strong> {draft.appliedBy}
              </p>
              {draft.appliedAt && (
                <p>
                  <strong>At:</strong>{" "}
                  {new Date(draft.appliedAt).toLocaleString()}
                </p>
              )}
            </div>
          )}

          {/* Comment field for approve/reject */}
          {isPending && canVet && (
            <div>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add a review comment..."
                className="text-sm"
                rows={2}
              />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {isPending && canVet && (
            <>
              <Button
                variant="destructive"
                onClick={handleReject}
                disabled={isActing || !comment.trim()}
              >
                {reject.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                <XCircle className="mr-2 h-4 w-4" />
                Reject
              </Button>
              <Button onClick={handleApprove} disabled={isActing}>
                {approve.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Approve
              </Button>
            </>
          )}

          {isApproved && canVet && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button onClick={handleApply} disabled={isActing}>
                    {apply.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    <Play className="mr-2 h-4 w-4" />
                    Apply Changes
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Applies the draft's changes to the live schedule
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {isPending && !canVet && (
            <p className="text-xs text-amber-600">
              Requires <strong>planning.vet</strong> permission to review
            </p>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
