import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { COLOR_GROUPS } from "@/lib/constants/color-groups";
import type { ColourGroup } from "@/hooks/use-colour-groups";

interface ColorGroupBadgeProps {
  code: string | null;
  /** Database-driven colour groups. Falls back to hardcoded constant if omitted. */
  colourGroups?: ColourGroup[];
}

export function ColorGroupBadge({ code, colourGroups }: ColorGroupBadgeProps) {
  if (!code) return <span className="text-muted-foreground">—</span>;

  // Try database-driven groups first, then fall back to hardcoded constant
  const dbGroup = colourGroups?.find((g) => g.code === code);
  const colour = dbGroup?.hexColour ?? COLOR_GROUPS[code]?.color ?? "#9ca3af";
  const name = dbGroup?.name ?? COLOR_GROUPS[code]?.name ?? code;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="inline-flex items-center gap-1.5">
          <div
            className="h-3.5 w-3.5 rounded border border-border"
            style={{ backgroundColor: colour }}
          />
          <span className="text-xs text-muted-foreground">{name}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>{code}</TooltipContent>
    </Tooltip>
  );
}
