import { useMemo } from "react";
import { format, addDays } from "date-fns";
import { ShopFloorDisplay } from "@/components/shop-floor/shop-floor-display";
import { Skeleton } from "@/components/ui/skeleton";
import { useWeek } from "@/hooks/use-week";
import { useBatches } from "@/hooks/use-batches";
import { useResources } from "@/hooks/use-resources";

export function ShopFloorPage() {
  const week = useWeek();
  const { data: resources = [], isLoading: resourcesLoading } = useResources();

  const weekStartStr = useMemo(
    () => format(week.weekStart, "yyyy-MM-dd"),
    [week.weekStart],
  );

  const { data: batches = [], isLoading: batchesLoading } = useBatches({
    weekStart: weekStartStr,
    weekEnding: week.weekEndingStr,
  });

  const dates = useMemo(() => {
    const result: string[] = [];
    let current = new Date(week.weekStart);
    const end = new Date(week.weekEnding);
    while (current <= end) {
      result.push(format(current, "yyyy-MM-dd"));
      current = addDays(current, 1);
    }
    return result;
  }, [week.weekStart, week.weekEnding]);

  if (batchesLoading || resourcesLoading) {
    return (
      <div className="min-h-screen bg-neutral-950 p-8">
        <Skeleton className="h-8 w-64 bg-neutral-800" />
        <Skeleton className="mt-4 h-[600px] w-full bg-neutral-800" />
      </div>
    );
  }

  return (
    <ShopFloorDisplay
      batches={batches}
      resources={resources}
      weekLabel={week.weekLabel}
      dates={dates}
    />
  );
}
