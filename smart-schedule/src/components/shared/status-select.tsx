import { useState } from "react";
import { ChevronDown, ChevronRight, ArrowLeft } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { BATCH_STATUSES, PRODUCTION_STATUS_LIST } from "@/lib/constants/statuses";
import type { BatchStatus } from "@/types/batch";
import {
  VARIABLE_TOP_LEVEL,
  OFF_STATUSES,
  OFF_SUB_LABELS,
} from "@/types/batch";
import { cn } from "@/lib/ui/cn";

interface StatusSelectProps {
  value: BatchStatus;
  onValueChange: (status: string) => void;
  disabled?: boolean;
}

/** Colour dot + label for a status */
function StatusDot({ status, label }: { status: BatchStatus; label?: string }) {
  const cfg = BATCH_STATUSES[status];
  if (!cfg) return null;

  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
        style={{ backgroundColor: cfg.color }}
      />
      <span>{label ?? cfg.label}</span>
    </div>
  );
}

/** Generic OFF colour (uses OFF Rework colour) */
const OFF_COLOR = "oklch(0.556 0.005 285.82)";

export function StatusSelect({
  value,
  onValueChange,
  disabled,
}: StatusSelectProps) {
  const [open, setOpen] = useState(false);
  const [showOffSub, setShowOffSub] = useState(false);

  const handleSelect = (status: BatchStatus) => {
    onValueChange(status);
    setOpen(false);
    setShowOffSub(false);
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) setShowOffSub(false);
  };

  const cfg = BATCH_STATUSES[value];

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium transition-colors",
            "hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            disabled && "pointer-events-none opacity-50",
          )}
        >
          <span
            className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: cfg?.color }}
          />
          {cfg?.label ?? value}
          <ChevronDown className="h-3.5 w-3.5 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1">
        {showOffSub ? (
          /* ── OFF sub-menu ─────────────────────────── */
          <div>
            <button
              onClick={() => setShowOffSub(false)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            >
              <ArrowLeft className="h-3 w-3" />
              Back
            </button>
            <div className="my-1 h-px bg-border" />
            <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
              OFF — Select reason
            </p>
            {OFF_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => handleSelect(s)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent",
                  value === s && "bg-accent font-medium",
                )}
              >
                <StatusDot status={s} label={OFF_SUB_LABELS[s]} />
              </button>
            ))}
          </div>
        ) : (
          /* ── Main menu ────────────────────────────── */
          <div>
            {/* Production group */}
            <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
              Production
            </p>
            {PRODUCTION_STATUS_LIST.map((s) => (
              <button
                key={s}
                onClick={() => handleSelect(s)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent",
                  value === s && "bg-accent font-medium",
                )}
              >
                <StatusDot status={s} />
              </button>
            ))}

            <div className="my-1 h-px bg-border" />

            {/* Variable group */}
            <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
              Variable
            </p>
            {VARIABLE_TOP_LEVEL.map((s) => (
              <button
                key={s}
                onClick={() => handleSelect(s)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent",
                  value === s && "bg-accent font-medium",
                )}
              >
                <StatusDot status={s} />
              </button>
            ))}

            {/* OFF parent — opens sub-menu */}
            <button
              onClick={() => setShowOffSub(true)}
              className={cn(
                "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent",
                OFF_STATUSES.includes(value) && "bg-accent font-medium",
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: OFF_COLOR }}
                />
                <span>OFF</span>
              </div>
              <ChevronRight className="h-3.5 w-3.5 opacity-50" />
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
