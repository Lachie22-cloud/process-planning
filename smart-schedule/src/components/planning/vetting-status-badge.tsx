import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { usePermissions } from "@/hooks/use-permissions";
import { ALLOWED_TRANSITIONS } from "@/hooks/use-vetting";
import { CheckCircle2, XCircle, Clock, MinusCircle } from "lucide-react";
import type { VettingStatus } from "@/types/batch";

interface VettingStatusBadgeProps {
  status: VettingStatus;
  onStatusChange?: (status: VettingStatus, comment: string | null) => void;
  isUpdating?: boolean;
}

const VETTING_CONFIG: Record<
  VettingStatus,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
    className: string;
    icon: typeof CheckCircle2;
  }
> = {
  pending: {
    label: "Pending",
    variant: "outline",
    className: "border-amber-300 text-amber-700",
    icon: Clock,
  },
  approved: {
    label: "Approved",
    variant: "default",
    className: "bg-green-600 text-white hover:bg-green-700",
    icon: CheckCircle2,
  },
  rejected: {
    label: "Rejected",
    variant: "destructive",
    className: "",
    icon: XCircle,
  },
  not_required: {
    label: "N/A",
    variant: "secondary",
    className: "",
    icon: MinusCircle,
  },
};

// ALLOWED_TRANSITIONS imported from @/hooks/use-vetting

export function VettingStatusBadge({
  status,
  onStatusChange,
  isUpdating,
}: VettingStatusBadgeProps) {
  const { hasPermission } = usePermissions();
  const canVet = hasPermission("planning.vet");
  const [comment, setComment] = useState("");
  const [open, setOpen] = useState(false);

  const config = VETTING_CONFIG[status];
  const Icon = config.icon;
  const transitions = ALLOWED_TRANSITIONS[status];

  const handleTransition = (newStatus: VettingStatus) => {
    onStatusChange?.(newStatus, comment.trim() || null);
    setComment("");
    setOpen(false);
  };

  // Read-only badge for users without vetting permission
  if (!canVet || !onStatusChange) {
    return (
      <Badge variant={config.variant} className={`text-[10px] ${config.className}`}>
        <Icon className="mr-1 h-3 w-3" />
        {config.label}
      </Badge>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex cursor-pointer items-center"
          disabled={isUpdating}
        >
          <Badge variant={config.variant} className={`text-[10px] ${config.className}`}>
            <Icon className="mr-1 h-3 w-3" />
            {config.label}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3" align="start">
        <div className="space-y-1">
          <h4 className="text-sm font-semibold">Update Vetting Status</h4>
          <p className="text-xs text-muted-foreground">
            Current: {config.label}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="vet-comment" className="text-xs">
            Comment (optional for approve, required for reject)
          </Label>
          <Textarea
            id="vet-comment"
            placeholder="Add a comment..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            className="text-xs"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {transitions.map((targetStatus) => {
            const targetConfig = VETTING_CONFIG[targetStatus];
            const TargetIcon = targetConfig.icon;
            const requiresComment = targetStatus === "rejected" && !comment.trim();

            return (
              <Button
                key={targetStatus}
                size="sm"
                variant={targetStatus === "approved" ? "default" : targetStatus === "rejected" ? "destructive" : "outline"}
                className="h-7 text-xs"
                disabled={isUpdating || requiresComment}
                onClick={() => handleTransition(targetStatus)}
              >
                <TargetIcon className="mr-1 h-3 w-3" />
                {targetConfig.label}
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
