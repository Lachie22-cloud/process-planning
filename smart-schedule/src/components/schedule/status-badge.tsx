import { BATCH_STATUSES } from "@/lib/constants/statuses";
import type { BatchStatus } from "@/types/batch";
import { cn } from "@/lib/ui/cn";

interface StatusBadgeProps {
  status: BatchStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = BATCH_STATUSES[status];

  if (!config) {
    return (
      <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", className)}>
        {status}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        config.bgClass,
        config.textClass,
        className,
      )}
    >
      {config.label}
    </span>
  );
}
