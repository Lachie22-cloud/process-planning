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
import { ArrowRight } from "lucide-react";
import { format } from "date-fns";

interface MoveReasonModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sapOrder: string;
  oldDate: string;
  newDate: string;
  oldResource: string;
  newResource: string;
  onConfirm: (reason: string) => void;
}

export function MoveReasonModal({
  open,
  onOpenChange,
  sapOrder,
  oldDate,
  newDate,
  oldResource,
  newResource,
  onConfirm,
}: MoveReasonModalProps) {
  const [reason, setReason] = useState("");

  const handleConfirm = () => {
    if (reason.trim()) {
      onConfirm(reason.trim());
      setReason("");
    }
  };

  const formatLabel = (dateStr: string) => {
    try {
      return format(new Date(dateStr + "T12:00:00"), "EEE d MMM");
    } catch {
      return dateStr;
    }
  };

  const dateChanged = oldDate !== newDate;
  const direction =
    dateChanged && newDate < oldDate ? "Pulled Forward" : dateChanged ? "Pushed Out" : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move Batch {sapOrder}</DialogTitle>
          <DialogDescription>
            A reason is required for this batch move.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded-md bg-muted p-3 text-sm">
          {dateChanged && (
            <div className="flex items-center gap-2">
              <span className="font-medium">Date:</span>
              <span>{formatLabel(oldDate)}</span>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span className="font-medium">{formatLabel(newDate)}</span>
              {direction && (
                <span className="ml-auto rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                  {direction}
                </span>
              )}
            </div>
          )}
          {oldResource !== newResource && (
            <div className="flex items-center gap-2">
              <span className="font-medium">Resource:</span>
              <span>{oldResource}</span>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span className="font-medium">{newResource}</span>
            </div>
          )}
        </div>

        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Enter reason for rescheduling..."
          className="min-h-[96px] resize-none"
          autoFocus
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!reason.trim()}>
            Confirm Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
