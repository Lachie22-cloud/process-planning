import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BATCH_STATUSES, BATCH_STATUS_LIST } from "@/lib/constants/statuses";
import type { BatchStatus } from "@/types/batch";

interface StatusSelectProps {
  value: BatchStatus;
  onValueChange: (status: string) => void;
  disabled?: boolean;
}

function StatusDot({ status }: { status: BatchStatus }) {
  const cfg = BATCH_STATUSES[status];
  if (!cfg) return null;

  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
        style={{ backgroundColor: cfg.color }}
      />
      <span>{cfg.label}</span>
    </div>
  );
}

export function StatusSelect({
  value,
  onValueChange,
  disabled,
}: StatusSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className="h-7 w-auto gap-1.5">
        <SelectValue>
          <StatusDot status={value} />
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {BATCH_STATUS_LIST.map((s) => (
          <SelectItem key={s} value={s}>
            <StatusDot status={s} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
