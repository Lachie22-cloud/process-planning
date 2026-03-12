import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/ui/cn";
import type { PlacementScore } from "@/types/scoring";

interface ScoreTooltipProps {
  score: PlacementScore;
  children: React.ReactNode;
}

/** Human-readable labels for soft factor identifiers */
const FACTOR_LABELS: Record<string, string> = {
  colour_transition: "Colour Transition",
  utilisation: "Utilisation",
  trunk_line_match: "Trunk Line",
  group_match: "Group Match",
  workload_balance: "Workload Balance",
  wom_check: "Material Availability",
  substitution: "Substitution",
};

/**
 * Tooltip that shows a per-factor breakdown of a PlacementScore.
 * Wraps its children (e.g. the overlay cell) and shows on hover.
 */
export function ScoreTooltip({ score, children }: ScoreTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="top"
        align="center"
        className="max-w-xs p-0"
        sideOffset={4}
      >
        <div className="space-y-1 p-2 text-xs">
          {/* Header with overall score */}
          <div className="flex items-center justify-between gap-4 border-b pb-1">
            <span className="font-semibold">
              {score.feasible ? "Placement Score" : "Blocked"}
            </span>
            <span
              className={cn(
                "font-mono font-bold tabular-nums",
                !score.feasible
                  ? "text-red-500"
                  : score.score >= 70
                    ? "text-emerald-600"
                    : score.score >= 40
                      ? "text-amber-600"
                      : "text-orange-600",
              )}
            >
              {Math.round(score.score)}
            </span>
          </div>

          {/* Hard violations */}
          {score.violations.length > 0 && (
            <div className="space-y-0.5">
              {score.violations.map((v) => (
                <div
                  key={v}
                  className="flex items-center gap-1 text-red-500"
                >
                  <span className="text-[10px]">&#x2716;</span>
                  <span className="capitalize">
                    {v.replace(/_/g, " ")}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Soft factor breakdown */}
          {score.feasible && score.factors.length > 0 && (
            <div className="space-y-0.5">
              {score.factors.map((f) => (
                <div
                  key={f.factor}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="text-muted-foreground truncate">
                    {FACTOR_LABELS[f.factor] ?? f.factor}
                  </span>
                  <span
                    className={cn(
                      "font-mono text-[10px] tabular-nums shrink-0",
                      f.weighted > 0
                        ? "text-emerald-600"
                        : f.weighted < 0
                          ? "text-red-500"
                          : "text-muted-foreground",
                    )}
                  >
                    {f.weighted > 0 ? "+" : ""}
                    {f.weighted.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
