import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { User, Clock } from "lucide-react";
import { format } from "date-fns";
import { useAuditLog } from "@/hooks/use-audit-log";

interface AuditLogProps {
  batchId?: string;
}

function formatTimestamp(dateStr: string): string {
  try {
    return format(new Date(dateStr), "d MMM yyyy, HH:mm");
  } catch {
    return dateStr;
  }
}

export function AuditLog({ batchId }: AuditLogProps) {
  const { data: entries = [], isLoading } = useAuditLog(batchId);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        No audit entries found.
      </p>
    );
  }

  return (
    <ScrollArea className="max-h-64">
      <div className="relative space-y-4 border-l-2 border-muted pl-4">
        {entries.map((entry) => (
          <div key={entry.id} className="relative">
            {/* Timeline dot */}
            <div className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-muted-foreground" />

            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-semibold">{entry.action}</span>
              <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                {formatTimestamp(entry.performedAt)}
              </span>
            </div>

            {entry.details && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {typeof entry.details === "object"
                  ? JSON.stringify(entry.details)
                  : String(entry.details)}
              </p>
            )}

            {entry.performedBy && (
              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground/70">
                <User className="h-3 w-3" />
                <span>{entry.performedBy}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
