import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/schedule/status-badge";
import type { BatchStatus } from "@/types/batch";
import { COMMENT_REQUIRED_STATUSES, OPTIONAL_COMMENT_STATUSES } from "@/types/batch";

/** Status-specific prompt text */
const STATUS_PROMPTS: Partial<Record<BatchStatus, string>> = {
  NCB: "Describe the quality issue requiring NCB hold",
  "OFF Rework": "Explain why this job is going to rework",
  "OFF WOM": "Detail the material shortage",
  "OFF WOP": "Detail the packaging shortage",
  Hold: "Explain the reason for placing this batch on hold",
  "Job Complete": "Optionally describe any excess paint generated",
};

interface StatusCommentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  sapOrder: string;
  newStatus: BatchStatus;
  onConfirm: (data: {
    comment: string;
    excessPaintComment?: string;
    bulkOffComment?: string;
  }) => void;
}

export function StatusCommentModal({
  open,
  onOpenChange,
  batchId: _batchId,
  sapOrder,
  newStatus,
  onConfirm,
}: StatusCommentModalProps) {
  const [comment, setComment] = useState("");
  const [bulkOffComment, setBulkOffComment] = useState("");
  const [excessPaintComment, setExcessPaintComment] = useState("");

  const isRequired = COMMENT_REQUIRED_STATUSES.includes(newStatus);
  const isOptional = OPTIONAL_COMMENT_STATUSES.includes(newStatus);
  const isOffRework = newStatus === "OFF Rework";
  const isJobComplete = newStatus === "Job Complete";

  const canConfirm = isRequired ? comment.trim().length > 0 : true;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm({
      comment: comment.trim(),
      ...(isOffRework && bulkOffComment.trim()
        ? { bulkOffComment: bulkOffComment.trim() }
        : {}),
      ...(isJobComplete && excessPaintComment.trim()
        ? { excessPaintComment: excessPaintComment.trim() }
        : {}),
    });
    setComment("");
    setBulkOffComment("");
    setExcessPaintComment("");
  };

  const handleClose = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (!isOpen) {
      setComment("");
      setBulkOffComment("");
      setExcessPaintComment("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Status Change
            <StatusBadge status={newStatus} />
          </DialogTitle>
          <DialogDescription>
            {isRequired
              ? `A comment is required when setting batch ${sapOrder} to ${newStatus}.`
              : `Optionally add details for batch ${sapOrder}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Main comment */}
          <div className="space-y-2">
            <Label htmlFor="status-comment">
              {isRequired ? "Reason (required)" : "Comment (optional)"}
            </Label>
            <Textarea
              id="status-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={STATUS_PROMPTS[newStatus] ?? "Enter reason / details\u2026"}
              className="min-h-[80px] resize-none"
              autoFocus
            />
          </div>

          {/* OFF Rework: bulk off comment (optional) */}
          {isOffRework && (
            <div className="space-y-2">
              <Label htmlFor="bulk-off-comment">
                Bulk Off Details (optional)
              </Label>
              <p className="text-xs text-muted-foreground">
                Detail what product was bulked off into. Can be entered later
                once bulk is completed.
              </p>
              <Textarea
                id="bulk-off-comment"
                value={bulkOffComment}
                onChange={(e) => setBulkOffComment(e.target.value)}
                placeholder="What product was bulked off into\u2026"
                className="min-h-[64px] resize-none"
              />
            </div>
          )}

          {/* Job Complete: excess paint comment (optional) */}
          {isJobComplete && (
            <div className="space-y-2">
              <Label htmlFor="excess-paint-comment">
                Excess Paint (optional)
              </Label>
              <p className="text-xs text-muted-foreground">
                If any excess paint was generated, describe it below. An EXCESS
                indicator will be shown on the batch.
              </p>
              <Textarea
                id="excess-paint-comment"
                value={excessPaintComment}
                onChange={(e) => setExcessPaintComment(e.target.value)}
                placeholder="Describe excess paint generated\u2026"
                className="min-h-[64px] resize-none"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            {isOptional ? "Complete" : "Save with Comment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
