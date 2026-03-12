import { Card, CardContent } from "@/components/ui/card";
import { Layers, Droplets, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { Batch } from "@/types/batch";

interface SummaryCardsProps {
  batches: Batch[];
}

export function SummaryCards({ batches }: SummaryCardsProps) {
  const totalBatches = batches.length;
  const totalVolume = batches.reduce(
    (sum, b) => sum + (b.batchVolume ?? 0),
    0,
  );
  const materialIssues = batches.filter(
    (b) => !b.rmAvailable || !b.packagingAvailable,
  ).length;
  const completed = batches.filter((b) => b.status === "Complete").length;

  const cards = [
    {
      label: "Total Batches",
      value: totalBatches.toLocaleString(),
      icon: Layers,
      colour: "text-foreground",
    },
    {
      label: "Total Volume",
      value: `${totalVolume.toLocaleString()}L`,
      icon: Droplets,
      colour: "text-foreground",
    },
    {
      label: "Material Issues",
      value: materialIssues.toLocaleString(),
      icon: AlertTriangle,
      colour: materialIssues > 0 ? "text-amber-600" : "text-foreground",
    },
    {
      label: "Completed",
      value: completed.toLocaleString(),
      icon: CheckCircle2,
      colour: completed > 0 ? "text-emerald-600" : "text-foreground",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardContent className="flex items-center gap-4 p-4">
            <card.icon className={`h-8 w-8 shrink-0 ${card.colour} opacity-80`} />
            <div>
              <p className="text-sm text-muted-foreground">{card.label}</p>
              <p className={`text-2xl font-bold ${card.colour}`}>
                {card.value}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
