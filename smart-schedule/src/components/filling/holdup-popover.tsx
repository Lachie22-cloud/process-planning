import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const PRESET_REASONS = [
  { label: "WOM — No raw materials", value: "WOM" },
  { label: "WOP — No packaging",     value: "WOP" },
  { label: "NCB — Quality hold",     value: "NCB" },
  { label: "Hold — Other",           value: "Hold" },
];

interface HoldUpPopoverProps {
  currentNote: string | null;
  onSave: (note: string | null) => void;
}

export function HoldUpPopover({ currentNote, onSave }: HoldUpPopoverProps) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [mode, setMode] = useState<"presets" | "custom">("presets");

  const hasHoldUp = !!currentNote;

  function handlePreset(value: string) {
    onSave(value);
    setOpen(false);
  }

  function handleCustomSave() {
    const note = custom.trim();
    if (note) {
      onSave(note);
      setCustom("");
      setMode("presets");
      setOpen(false);
    }
  }

  function handleClear() {
    onSave(null);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          title={currentNote ?? "Add hold-up note"}
          className={cn(
            "grid h-5 w-5 flex-shrink-0 place-items-center rounded transition",
            hasHoldUp
              ? "text-amber-500 hover:text-amber-600"
              : "text-muted-foreground/50 opacity-0 group-hover:opacity-100 hover:text-amber-500",
          )}
        >
          <AlertTriangle className="h-3 w-3" />
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-56 p-2" align="start">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11.5px] font-semibold text-foreground">Hold-up reason</span>
          {hasHoldUp && (
            <button
              onClick={handleClear}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>

        {currentNote && (
          <div className="mb-2 rounded-md bg-amber-50 px-2 py-1 text-[10.5px] text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800">
            {currentNote}
          </div>
        )}

        {mode === "presets" ? (
          <div className="flex flex-col gap-0.5">
            {PRESET_REASONS.map((r) => (
              <button
                key={r.value}
                onClick={() => handlePreset(r.value)}
                className="rounded-md px-2 py-1.5 text-left text-[11.5px] text-foreground transition hover:bg-muted"
              >
                {r.label}
              </button>
            ))}
            <button
              onClick={() => setMode("custom")}
              className="rounded-md px-2 py-1.5 text-left text-[11.5px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              Custom…
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <button
              onClick={() => setMode("presets")}
              className="text-left text-[10.5px] text-muted-foreground hover:text-foreground"
            >
              ← Back
            </button>
            <input
              autoFocus
              type="text"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCustomSave()}
              placeholder="Describe the hold-up…"
              className="w-full rounded-md border bg-background px-2 py-1 text-[11.5px] outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={handleCustomSave}
              disabled={!custom.trim()}
              className="rounded-md bg-foreground px-3 py-1 text-[11.5px] font-medium text-background transition disabled:opacity-40 hover:opacity-90"
            >
              Save
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
