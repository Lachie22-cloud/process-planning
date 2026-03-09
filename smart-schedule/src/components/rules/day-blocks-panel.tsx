import { useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, CalendarOff } from "lucide-react";
import {
  useDayBlocks,
  useAddDayBlock,
  useRemoveDayBlock,
} from "@/hooks/use-day-blocks";

interface DayBlocksPanelProps {
  canEdit: boolean;
}

export function DayBlocksPanel({ canEdit }: DayBlocksPanelProps) {
  const { data: dayBlocks = [], isLoading } = useDayBlocks();
  const addBlock = useAddDayBlock();
  const removeBlock = useRemoveDayBlock();

  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");

  const handleAdd = () => {
    if (!date) return;
    addBlock.mutate(
      { blockDate: date, reason: reason || undefined },
      {
        onSuccess: () => {
          setDate("");
          setReason("");
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Date
            </label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-44"
            />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Reason (optional)
            </label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Public holiday, maintenance"
            />
          </div>
          <Button onClick={handleAdd} disabled={!date || addBlock.isPending}>
            <CalendarOff className="mr-1 h-4 w-4" />
            Block Day
          </Button>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : dayBlocks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No day blocks configured.
        </p>
      ) : (
        <div className="divide-y rounded-md border">
          {dayBlocks.map((block) => (
            <div
              key={block.id}
              className="flex items-center justify-between px-4 py-2 text-sm"
            >
              <div className="flex items-center gap-3">
                <span className="font-medium tabular-nums">
                  {format(
                    new Date(block.blockDate + "T12:00:00"),
                    "EEE d MMM yyyy",
                  )}
                </span>
                {block.reason && (
                  <span className="text-muted-foreground">{block.reason}</span>
                )}
              </div>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => removeBlock.mutate(block.id)}
                  disabled={removeBlock.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
