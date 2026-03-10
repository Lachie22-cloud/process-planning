import { useState } from "react";
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
} from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import {
  useAiDrafts,
  useApproveDraft,
  useRejectDraft,
  useApplyDraft,
  type AiDraft,
  type DraftStatus,
} from "@/hooks/use-ai-drafts";
import { formatDistanceToNow } from "date-fns";

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

export function DraftReviewPanel({ compactMode = false }: { compactMode?: boolean } = {}) {
  const { hasPermission } = usePermissions();
  const canViewDrafts = hasPermission("planning.ai");
  const canVet = hasPermission("planning.vet");

  const { data: drafts = [], isLoading } = useAiDrafts();
  const [selectedDraft, setSelectedDraft] = useState<AiDraft | null>(null);

  if (!canViewDrafts) return null;

  const pendingDrafts = drafts.filter((d) => d.status === "pending");
  const otherDrafts = drafts.filter((d) => d.status !== "pending");

  // In compact mode, hide entirely when there are no pending drafts
  if (compactMode && pendingDrafts.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-5 w-5" />
          AI Drafts
          {pendingDrafts.length > 0 && (
            <Badge variant="secondary" className="ml-auto">
              {pendingDrafts.length} pending
            </Badge>
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
                      onSelect={() => setSelectedDraft(draft)}
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
                        onSelect={() => setSelectedDraft(draft)}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>

      {selectedDraft && (
        <DraftDetailDialog
          draft={selectedDraft}
          canVet={canVet}
          onClose={() => setSelectedDraft(null)}
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
/*  Draft Detail Dialog                                                */
/* ------------------------------------------------------------------ */

function DraftDetailDialog({
  draft,
  canVet,
  onClose,
}: {
  draft: AiDraft;
  canVet: boolean;
  onClose: () => void;
}) {
  const [comment, setComment] = useState("");
  const approve = useApproveDraft();
  const reject = useRejectDraft();
  const apply = useApplyDraft();

  const isPending = draft.status === "pending";
  const isApproved = draft.status === "approved";
  const isActing = approve.isPending || reject.isPending || apply.isPending;

  const handleApprove = () => {
    approve.mutate(
      { draftId: draft.id, comment: comment || undefined },
      { onSuccess: onClose },
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

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCheck className="h-5 w-5" />
            {draft.title}
          </DialogTitle>
          <DialogDescription>
            {DRAFT_TYPE_LABELS[draft.draftType] ?? draft.draftType}
            {" \u00b7 "}
            {draftStatusBadge(draft.status)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {draft.description && (
            <p className="text-sm text-muted-foreground">{draft.description}</p>
          )}

          {/* Payload preview */}
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Payload
            </p>
            <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(draft.payload, null, 2)}
            </pre>
          </div>

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
                  Applies the draft's changes to the live system
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
