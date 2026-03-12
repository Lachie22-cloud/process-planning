import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const QC_STAGES = ["Mixing", "Lab", "Filling", "Other"] as const;
export type QcStage = (typeof QC_STAGES)[number];

interface QcStageSelectorProps {
  value: string | null;
  onChange: (stage: string | null) => void;
  disabled?: boolean;
}

export function QcStageSelector({
  value,
  onChange,
  disabled = false,
}: QcStageSelectorProps) {
  return (
    <Select
      value={value ?? "none"}
      onValueChange={(v) => onChange(v === "none" ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger className="w-[160px]">
        <SelectValue placeholder="Select stage…" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Not observed</SelectItem>
        {QC_STAGES.map((stage) => (
          <SelectItem key={stage} value={stage}>
            {stage}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
