import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/ui/cn";
import type { Batch } from "@/types/batch";
import type { Resource } from "@/types/resource";
import { format, subDays } from "date-fns";

interface StockHeatmapProps {
  batches: Batch[];
  resources: Resource[];
  weekEnding: Date;
  weeksToShow?: number;
}

function getIntensityClass(volume: number, maxVolume: number): string {
  if (volume === 0) return "bg-muted";
  const ratio = volume / maxVolume;
  if (ratio < 0.25) return "bg-blue-100 text-blue-800";
  if (ratio < 0.5) return "bg-blue-200 text-blue-900";
  if (ratio < 0.75) return "bg-blue-400 text-white";
  return "bg-blue-600 text-white";
}

export function StockHeatmap({
  batches,
  resources,
  weekEnding,
  weeksToShow = 6,
}: StockHeatmapProps) {
  // Only show mixer-type resources (exclude pots)
  const mixers = useMemo(
    () =>
      resources.filter(
        (r) => r.resourceType === "mixer" || r.resourceType === "disperser",
      ),
    [resources],
  );

  // Generate week ending dates
  const weeks = useMemo(() => {
    const result: Date[] = [];
    for (let i = weeksToShow - 1; i >= 0; i--) {
      result.push(subDays(weekEnding, i * 7));
    }
    return result;
  }, [weekEnding, weeksToShow]);

  // Build heatmap data: mixer x week -> total volume
  const { heatData, maxVolume } = useMemo(() => {
    const data: Record<string, Record<string, number>> = {};
    let max = 0;

    for (const mixer of mixers) {
      data[mixer.id] = {};
      for (const we of weeks) {
        const weekStart = subDays(we, 4); // Mon-Fri work week
        const wsStr = format(weekStart, "yyyy-MM-dd");
        const weStr = format(we, "yyyy-MM-dd");

        const weekBatches = batches.filter(
          (b) =>
            b.planResourceId === mixer.id &&
            b.planDate != null &&
            b.planDate >= wsStr &&
            b.planDate <= weStr,
        );

        const totalVol = weekBatches.reduce(
          (sum, b) => sum + (b.batchVolume ?? 0),
          0,
        );
        data[mixer.id]![weStr] = totalVol;
        if (totalVol > max) max = totalVol;
      }
    }

    return { heatData: data, maxVolume: max || 1 };
  }, [mixers, weeks, batches]);

  if (mixers.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          Mixer Volume Heatmap ({weeksToShow} weeks)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Legend */}
        <div className="mb-3 flex items-center gap-3 text-[10px] text-muted-foreground">
          <span>Volume:</span>
          <div className="flex items-center gap-1">
            <div className="h-3 w-6 rounded bg-muted" />
            <span>None</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-3 w-6 rounded bg-blue-100" />
            <span>Low</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-3 w-6 rounded bg-blue-200" />
            <span>Medium</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-3 w-6 rounded bg-blue-400" />
            <span>High</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-3 w-6 rounded bg-blue-600" />
            <span>Peak</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="w-40 border px-2 py-1.5 text-left font-medium text-muted-foreground">
                  Resource
                </th>
                {weeks.map((we) => (
                  <th
                    key={we.toISOString()}
                    className="border px-2 py-1.5 text-center font-medium text-muted-foreground"
                  >
                    {format(we, "d MMM")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mixers.map((mixer) => (
                <tr key={mixer.id}>
                  <td className="border px-2 py-1.5">
                    <div className="font-medium">
                      {mixer.displayName ?? mixer.resourceCode}
                    </div>
                    {mixer.trunkLine && (
                      <div className="text-[10px] text-muted-foreground">
                        {mixer.trunkLine}
                      </div>
                    )}
                  </td>
                  {weeks.map((we) => {
                    const weStr = format(we, "yyyy-MM-dd");
                    const vol = heatData[mixer.id]?.[weStr] ?? 0;
                    return (
                      <td
                        key={weStr}
                        className={cn(
                          "border px-2 py-1.5 text-center tabular-nums transition-colors",
                          getIntensityClass(vol, maxVolume),
                        )}
                      >
                        {vol > 0 ? vol.toLocaleString() : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {/* Totals row */}
              <tr className="font-semibold">
                <td className="border px-2 py-1.5">Total</td>
                {weeks.map((we) => {
                  const weStr = format(we, "yyyy-MM-dd");
                  const total = mixers.reduce(
                    (sum, m) => sum + (heatData[m.id]?.[weStr] ?? 0),
                    0,
                  );
                  return (
                    <td
                      key={weStr}
                      className="border px-2 py-1.5 text-center tabular-nums"
                    >
                      {total > 0 ? total.toLocaleString() : "—"}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>

      </CardContent>
    </Card>
  );
}
