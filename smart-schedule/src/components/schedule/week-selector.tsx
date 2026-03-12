import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import type { useWeek } from "@/hooks/use-week";

type WeekState = ReturnType<typeof useWeek>;

interface WeekSelectorProps {
  week: WeekState;
}

export function WeekSelector({ week }: WeekSelectorProps) {
  return (
    <div className="flex items-center gap-1 rounded-lg border bg-card">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-r-none"
            onClick={week.previousWeek}
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Previous week</TooltipContent>
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
            onClick={week.nextWeek}
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Next week</TooltipContent>
      </Tooltip>

      {!week.isThisWeek && (
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
