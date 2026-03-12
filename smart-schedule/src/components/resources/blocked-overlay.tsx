import { Lock } from "lucide-react";

interface BlockedOverlayProps {
  reason: string | null;
}

export function BlockedOverlay({ reason }: BlockedOverlayProps) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center rounded"
      style={{
        background:
          "repeating-linear-gradient(135deg, hsl(var(--muted)) 0px, hsl(var(--muted)) 6px, hsl(var(--border)) 6px, hsl(var(--border)) 12px)",
        opacity: 0.85,
      }}
    >
      <div className="flex items-center gap-1.5 rounded-md bg-background/90 px-2 py-1 text-xs font-medium text-muted-foreground shadow-sm">
        <Lock className="h-3 w-3" />
        <span className="truncate max-w-[120px]">
          {reason ?? "Blocked"}
        </span>
      </div>
    </div>
  );
}
