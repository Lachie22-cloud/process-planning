import { BATCH_STATUSES } from "@/lib/constants/statuses";
import type { BatchStatus } from "@/types/batch";
import { cn } from "@/lib/ui/cn";

interface StatusBadgeProps {
  status: BatchStatus;
  className?: string;
  /** When true, shows an EXCESS pill alongside Job Complete */
  showExcess?: boolean;
}

export function StatusBadge({ status, className, showExcess }: StatusBadgeProps) {
  const config = BATCH_STATUSES[status];

  if (!config) {
    return (
      <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", className)}>
        {status}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
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
      {showExcess && status === "Job Complete" && (
        <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          EXCESS
        </span>
      )}
    </span>
  );
}
