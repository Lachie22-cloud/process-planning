import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowRight,
  RefreshCw,
  ToggleRight,
  MapPin,
  MessageSquare,
  Clock,
  User,
} from "lucide-react";
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

/** Extract a display name from a user string — strip UUIDs, show email or name */
function formatUser(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // If it looks like a UUID, hide it
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(raw)) return null;
  // If it's an email, show just the name part
  if (raw.includes("@")) {
    const name = raw.split("@")[0] ?? raw;
    return name
      .replace(/[._]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return raw;
}

const FIELD_LABELS: Record<string, string> = {
  ebrBatch: "EBR Batch",
  observationRequired: "Observation Required",
  physicalLocation: "Physical Location",
  status: "Status",
  statusComment: "Status Comment",
  planDate: "Plan Date",
  planResourceId: "Resource Assignment",
  planDisperserId: "Disperser Assignment",
  qcObservedStage: "QC Observation Stage",
  qcObservedAt: "QC Observed At",
  qcObservedBy: "QC Observed By",
  rmAvailable: "Raw Materials Available",
  packagingAvailable: "Packaging Available",
  batchVolume: "Batch Volume",
  vettingStatus: "Vetting Status",
  vettedBy: "Vetted By",
};

function formatFieldValue(field: string, value: unknown): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (value === null || value === undefined) return "cleared";
  return String(value);
}

/** Render a human-readable description for an audit entry */
function AuditDescription({
  action,
  details,
}: {
  action: string;
  details: Record<string, unknown> | null;
}) {
  if (!details) return null;

  const changedBy = formatUser(details.changed_by as string | undefined);

  if (action === "status_change") {
    const from = details.from as string | undefined;
    const to = details.to as string | undefined;
    const comment = details.comment as string | undefined;
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <ArrowRight className="h-3 w-3 shrink-0 text-blue-500" />
          <span>
            Status changed{from ? ` from ${from}` : ""}{to ? ` to ${to}` : ""}
          </span>
        </div>
        {comment && (
          <div className="flex items-start gap-1.5 pl-[18px] text-xs text-muted-foreground">
            <MessageSquare className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="italic">{comment}</span>
          </div>
        )}
        {changedBy && (
          <p className="pl-[18px] text-xs text-muted-foreground/70">
            by {changedBy}
          </p>
        )}
      </div>
    );
  }

  if (action === "field_update") {
    const field = details.field as string | undefined;
    const value = details.value;
    const label = field ? (FIELD_LABELS[field] ?? field) : "field";
    return (
      <div className="space-y-0.5">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <ToggleRight className="h-3 w-3 shrink-0 text-purple-500" />
          <span>
            {label} set to <strong>{formatFieldValue(label, value)}</strong>
          </span>
        </div>
        {changedBy && (
          <p className="pl-[18px] text-xs text-muted-foreground/70">
            by {changedBy}
          </p>
        )}
      </div>
    );
  }

  if (action === "reschedule" || action === "schedule_change") {
    const from = details.from_date as string | undefined;
    const to = details.to_date as string | undefined;
    return (
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <RefreshCw className="h-3 w-3 shrink-0 text-amber-500" />
        <span>
          Rescheduled{from ? ` from ${from}` : ""}{to ? ` to ${to}` : ""}
        </span>
      </div>
    );
  }

  if (action === "location_change") {
    const location = details.location as string | undefined;
    return (
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <MapPin className="h-3 w-3 shrink-0 text-cyan-500" />
        <span>
          Moved to {location ?? "unknown location"}
        </span>
      </div>
    );
  }

  // Fallback: render details as key-value pairs, filtering out UUIDs and technical fields
  const displayPairs = Object.entries(details).filter(
    ([key, val]) =>
      key !== "changed_by" &&
      key !== "performed_by" &&
      !(typeof val === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(val)),
  );

  if (displayPairs.length === 0) return null;

  return (
    <div className="text-sm text-muted-foreground">
      {displayPairs.map(([key, val]) => (
        <span key={key} className="mr-3">
          <span className="capitalize">{key.replace(/_/g, " ")}</span>:{" "}
          <strong>{formatFieldValue(key, val)}</strong>
        </span>
      ))}
      {changedBy && (
        <p className="mt-0.5 text-xs text-muted-foreground/70">by {changedBy}</p>
      )}
    </div>
  );
}

/** Action labels for human-readable display */
const ACTION_LABELS: Record<string, string> = {
  status_change: "Status Change",
  field_update: "Field Updated",
  reschedule: "Rescheduled",
  schedule_change: "Schedule Change",
  location_change: "Location Change",
  purge_site_data: "Data Purged",
  import: "Data Imported",
  vetting_approved: "Vetting Approved",
  vetting_rejected: "Vetting Rejected",
};

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
        No activity yet.
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
              <span className="text-sm font-medium">
                {ACTION_LABELS[entry.action] ?? entry.action.replace(/_/g, " ")}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                {formatTimestamp(entry.performedAt)}
              </span>
            </div>

            <AuditDescription
              action={entry.action}
              details={entry.details}
            />

            {/* Show performer if not already shown in description */}
            {entry.performedBy &&
              !entry.details?.changed_by &&
              formatUser(entry.performedBy) && (
                <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground/70">
                  <User className="h-3 w-3" />
                  <span>{formatUser(entry.performedBy)}</span>
                </div>
              )}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
