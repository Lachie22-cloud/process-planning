import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight, CalendarDays, Lock } from "lucide-react";
import type { useWeek } from "@/hooks/use-week";

type WeekState = ReturnType<typeof useWeek>;

interface WeekSelectorProps {
  week: WeekState;
}

export function WeekSelector({ week }: WeekSelectorProps) {
  const forwardBlocked =
    (!week.canViewFutureWeeks && week.isThisWeek) ||
    (!week.canViewFutureWeeks && !week.canViewCurrentWeek);
  const backwardBlocked = !week.canViewPastWeeks && week.isThisWeek;

  const forwardTooltip = !week.canViewFutureWeeks
    ? "Future weeks are restricted for your role"
    : !week.canViewCurrentWeek
      ? "Current week is restricted for your role"
      : "Next week";

  const backwardTooltip = !week.canViewPastWeeks
    ? "Past weeks are restricted for your role"
    : !week.canViewCurrentWeek
      ? "Current week is restricted for your role"
      : "Previous week";

  return (
    <div className="flex items-center gap-1 rounded-lg border bg-card">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-r-none"
            onClick={backwardBlocked ? undefined : week.previousWeek}
            disabled={backwardBlocked}
            aria-label="Previous week"
          >
            {backwardBlocked ? (
              <Lock className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{backwardTooltip}</TooltipContent>
      </Tooltip>

      <div className="flex items-center gap-2 px-3">
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium whitespace-nowrap">
          {week.weekLabel}
        </span>
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-l-none"
            onClick={forwardBlocked ? undefined : week.nextWeek}
            disabled={forwardBlocked}
            aria-label="Next week"
          >
            {forwardBlocked ? (
              <Lock className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{forwardTooltip}</TooltipContent>
      </Tooltip>

      {!week.isThisWeek && week.canViewCurrentWeek && (
        <Button
          variant="outline"
          size="sm"
          className="ml-2 h-8 text-xs"
          onClick={week.goToThisWeek}
        >
          Today
        </Button>
      )}
    </div>
  );
}
