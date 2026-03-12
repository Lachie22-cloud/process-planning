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
import { StatusBadge } from "@/components/schedule/status-badge";
import type { BatchStatus } from "@/types/batch";

interface StatusCommentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  sapOrder: string;
  newStatus: BatchStatus;
  onConfirm: (comment: string) => void;
}

export function StatusCommentModal({
  open,
  onOpenChange,
  batchId,
  sapOrder,
  newStatus,
  onConfirm,
}: StatusCommentModalProps) {
  const [comment, setComment] = useState("");

  const handleConfirm = () => {
    if (comment.trim()) {
      onConfirm(comment.trim());
      setComment("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Status Change
            <StatusBadge status={newStatus} />
          </DialogTitle>
          <DialogDescription>
            A comment is required when setting batch{" "}
            <strong>{sapOrder}</strong> to <strong>{newStatus}</strong> (ID: {batchId}).
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Enter reason / details…"
          className="min-h-[96px] resize-none"
          autoFocus
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!comment.trim()}>
            Save with Comment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
