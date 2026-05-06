import { useState, useEffect, useRef } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "./status-badge";
import { StatusSelect } from "@/components/shared/status-select";
import { StatusCommentModal } from "@/components/shared/status-comment-modal";
import { AuditLog } from "@/components/shared/audit-log";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  History,
  MapPin,
  CircleAlert,
  Loader2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { mapLinkedFillOrder } from "@/lib/utils/mappers";
import { parsePackSizeLitres } from "@/lib/utils/pack-size";
import type { DatabaseRow } from "@/types/database";
import { useBatch } from "@/hooks/use-batches";
import type { LinkedFillOrder } from "@/types/batch";
import { useUpdateBatch, useAddAuditEntry, useDeleteBatch } from "@/hooks/use-batch-mutations";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { usePermissions } from "@/hooks/use-permissions";
import { useCurrentSite } from "@/hooks/use-current-site";
import { COMMENT_REQUIRED_STATUSES, OPTIONAL_COMMENT_STATUSES } from "@/types/batch";
import type { BatchStatus, Batch } from "@/types/batch";
import type { Resource } from "@/types/resource";
import { BATCH_STATUSES } from "@/lib/constants/statuses";
import { useBatchShortages, useOverrideBatchShortage, useUpdateBatchShortageEta } from "@/hooks/use-material-shortages";
import { fillOrderHasComponent, RED_LID_COMPONENT, BLUE_LID_COMPONENT } from "@/lib/utils/pack-size";
import { useBatchCoverage } from "@/hooks/use-batch-coverage";
import { useAlertsForBatch } from "@/hooks/use-alerts";
import { useBatches } from "@/hooks/use-batches";
import type { BulkAlert } from "@/types/alert";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface BatchDetailSheetProps {
  batchId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resources: Resource[];
  onReschedule?: (batchId: string) => void;
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  try {
    return format(new Date(dateStr), "EEE d MMM yyyy, HH:mm");
  } catch {
    return dateStr;
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  try {
    return format(new Date(dateStr), "EEE d MMM yyyy");
  } catch {
    return dateStr;
  }
}

/** Derive fill requirement label from fillRequirement field or ipt fallback */
function getFillLabel(batch: { fillRequirement?: string | null; ipt?: number | null }): string {
  if (batch.fillRequirement && batch.fillRequirement !== "Standard") return batch.fillRequirement;
  if (batch.ipt === 1) return "Fill within 24hrs";
  if (batch.ipt === 2) return "Fill within 48hrs";
  return "Standard";
}

/** Two-column detail row used in Bulk/Fill info sections */
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="text-xs text-muted-foreground whitespace-nowrap">{label}:</span>
      <span className="text-sm font-medium text-right">{value ?? "\u2014"}</span>
    </div>
  );
}

const PHYSICAL_LOCATIONS = ["Mixing", "Lab", "Filling", "Waiting"] as const;

/** Status description map for the alert banner */
const STATUS_DESCRIPTIONS: Partial<Record<BatchStatus, string>> = {
  "OFF WOM": "Waiting on raw materials for this batch",
  "OFF WOP": "Packaging is not available for this batch",
  Hold: "Batch is on hold pending resolution",
  "On Test": "Batch is undergoing laboratory testing",
  "OFF Rework": "Job is going to rework",
  NCB: "Non-conforming batch — requires investigation",
};

/** Expanded labels for alert banner heading */
const STATUS_LABELS: Partial<Record<BatchStatus, string>> = {
  "OFF WOM": "OFF — Waiting On Materials",
  "OFF WOP": "OFF — Waiting On Packaging",
  "OFF Rework": "OFF — Rework",
  NCB: "NCB — Quality Hold",
};

function StatusAlertBanner({ batch }: { batch: Batch }) {
  const cfg = BATCH_STATUSES[batch.status];
  const description = STATUS_DESCRIPTIONS[batch.status];

  // Show banner for warning/alert statuses
  if (!description) return null;

  const isError = ["NCB"].includes(batch.status);
  const isWarning = ["OFF WOM", "OFF WOP", "Hold", "On Test", "OFF Rework"].includes(batch.status);

  if (!isError && !isWarning) return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <AlertTriangle
        className={`mt-0.5 h-4 w-4 shrink-0 ${
          isError ? "text-red-500" : "text-amber-500"
        }`}
      />
      <div>
        <p className="text-sm font-semibold">
          {STATUS_LABELS[batch.status] ?? cfg?.label}
        </p>
        <p className="text-xs text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

function BulkAlertBanner({
  alerts,
  batches,
}: {
  alerts: BulkAlert[];
  batches: Batch[];
}) {
  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2">
      {alerts.map((alert) => {
        const affectedCount = alert.bulkCode
          ? batches.filter((b) => b.bulkCode === alert.bulkCode).length
          : 1;

        return (
          <div
            key={alert.id}
            className="rounded-lg border border-border bg-white p-3 dark:bg-gray-900"
            style={{ borderLeftWidth: 4, borderLeftColor: "#f97316" }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-orange-500 shrink-0" strokeWidth={2.5} />
                <div>
                  <p className="text-sm font-bold text-foreground">
                    BULK ALERT
                  </p>
                  <p className="text-sm text-foreground">
                    {alert.message}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {alert.createdByName && (
                      <span>
                        Raised by: <strong className="text-foreground">{alert.createdByName}</strong>
                      </span>
                    )}
                    {alert.startDate && alert.endDate && (
                      <span>
                        Period: {format(new Date(alert.startDate), "d MMM yyyy")} &rarr;{" "}
                        {format(new Date(alert.endDate), "d MMM yyyy")}
                      </span>
                    )}
                    <span>
                      Batches affected: <strong className="text-foreground">{affectedCount}</strong>
                    </span>
                  </p>
                </div>
              </div>
              {alert.bulkCode && (
                <span className="font-mono text-sm font-bold text-foreground shrink-0">
                  {alert.bulkCode}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PhysicalLocationChips({
  batch,
  canEdit,
  onUpdate,
}: {
  batch: Batch;
  canEdit: boolean;
  onUpdate: (location: string | null) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Physical Location:</p>
      <div className="flex flex-wrap gap-1.5">
        {PHYSICAL_LOCATIONS.map((loc) => {
          const isActive = batch.physicalLocation === loc;
          return (
            <button
              key={loc}
              disabled={!canEdit}
              onClick={() => onUpdate(isActive ? null : loc)}
              className={`rounded-md border px-3 py-1 text-xs font-medium transition-colors ${
                isActive
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-accent"
              } ${!canEdit ? "cursor-default opacity-60" : "cursor-pointer"}`}
            >
              {loc}
            </button>
          );
        })}
      </div>
      {canEdit && (
        <p className="text-[10px] text-muted-foreground">
          Tip: In production, operators would update status via tablets or barcode scans on the shop floor
        </p>
      )}
    </div>
  );
}

function ShortageTable({
  shortages,
  canOverride,
  overrideMode,
  onOverride,
  onRevert,
  onEtaChange,
}: {
  shortages: (import("@/types/material-shortage").BatchMaterialShortage & { shortage: import("@/types/material-shortage").MaterialShortage })[];
  canOverride: boolean;
  overrideMode: boolean;
  onOverride: (target: { id: string; materialCode: string; shortQty: number; uom: string }) => void;
  onRevert: (batchShortageId: string) => void;
  onEtaChange: (batchShortageId: string, value: string) => void;
}) {
  if (shortages.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground min-w-[160px]">Material</th>
            <th className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground w-14">Type</th>
            <th className="px-2 py-1.5 text-right text-xs font-medium text-muted-foreground">Required</th>
            <th className="px-2 py-1.5 text-right text-xs font-medium text-muted-foreground">Short</th>
            <th className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">UOM</th>
            <th className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">ETA</th>
            <th className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground w-[80px]">Override</th>
          </tr>
        </thead>
        <tbody>
          {shortages.map((bs) => {
            const overrideActive = bs.plannerOverride || bs.shortage.plannerOverride;
            return (
              <tr key={bs.id} className={`border-b last:border-0 ${overrideActive ? "bg-green-50/30" : "bg-red-50/30"}`}>
                <td className="px-3 py-2">
                  <p className="font-mono text-xs font-semibold truncate max-w-[180px]">{bs.shortage.materialCode}</p>
                  {bs.shortage.materialDesc && (
                    <p className="text-[11px] text-muted-foreground truncate max-w-[180px]">{bs.shortage.materialDesc}</p>
                  )}
                </td>
                <td className="px-2 py-2">
                  <Badge
                    variant={bs.shortage.materialType === "RM" ? "destructive" : "outline"}
                    className="text-[10px]"
                  >
                    {bs.shortage.materialType}
                  </Badge>
                </td>
                <td className="px-2 py-2 text-right font-mono text-xs tabular-nums">
                  {(bs.requiredQty > 0 ? bs.requiredQty : Math.abs(bs.shortQty)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </td>
                <td className="px-2 py-2 text-right font-mono text-xs tabular-nums font-bold text-red-600">
                  {bs.shortQty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </td>
                <td className="px-2 py-2 text-xs text-muted-foreground">
                  {bs.shortage.uom}
                </td>
                <td className="px-2 py-2">
                  {canOverride ? (
                    <Input
                      type="date"
                      className="h-7 w-[110px] text-[11px] px-1"
                      defaultValue={bs.eta ?? bs.shortage.eta ?? ""}
                      onBlur={(e) => onEtaChange(bs.id, e.target.value)}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {(bs.eta ?? bs.shortage.eta) ? format(new Date((bs.eta ?? bs.shortage.eta)!), "d MMM yyyy") : "—"}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2">
                  {overrideActive && overrideMode ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px] border-red-200 text-red-600 hover:bg-red-50"
                      onClick={() => onRevert(bs.id)}
                    >
                      Undo
                    </Button>
                  ) : overrideActive ? (
                    <Badge
                      variant="secondary"
                      className="gap-1 text-[10px] bg-green-100 text-green-700 border-green-200"
                    >
                      <ShieldCheck className="h-3 w-3" />
                    </Badge>
                  ) : overrideMode ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => onOverride({
                        id: bs.id,
                        materialCode: bs.shortage.materialCode,
                        shortQty: bs.shortQty,
                        uom: bs.shortage.uom,
                      })}
                    >
                      Override
                    </Button>
                  ) : (
                    <span className="text-muted-foreground/40 text-[10px]">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const OVERRIDE_REASONS = [
  "SOH Check Completed",
  "Stock in transit",
  "Stock awaiting GR",
  "Other",
] as const;

type OverrideReason = (typeof OVERRIDE_REASONS)[number];

function MaterialAvailabilitySection({ batch, canOverride }: { batch: Batch; canOverride: boolean }) {
  const { data: batchShortages = [] } = useBatchShortages(batch.id);
  const overrideMutation = useOverrideBatchShortage();
  const etaMutation = useUpdateBatchShortageEta();
  const [overrideTarget, setOverrideTarget] = useState<{ id: string; materialCode: string; shortQty: number; uom: string } | null>(null);
  const [selectedReason, setSelectedReason] = useState<OverrideReason | "">("");
  const [overrideComment, setOverrideComment] = useState("");
  const [overrideMode, setOverrideMode] = useState(false);

  const activeShortages = batchShortages.filter((bs) => bs.shortQty < 0 || bs.shortage.shortQty < 0);
  const unresolvedCount = activeShortages.filter((bs) => !bs.plannerOverride && !bs.shortage.plannerOverride).length;

  const closeDialog = () => {
    setOverrideTarget(null);
    setSelectedReason("");
    setOverrideComment("");
  };

  const handleReasonChange = (reason: OverrideReason) => {
    setSelectedReason(reason);
    if (reason === "Other") {
      setOverrideComment("");
    } else {
      setOverrideComment(reason);
    }
  };

  const handleConfirm = () => {
    if (!overrideTarget || !overrideComment.trim()) return;
    overrideMutation.mutate(
      {
        batchShortageId: overrideTarget.id,
        batchId: batch.id,
        override: true,
        comment: overrideComment,
      },
      { onSuccess: closeDialog },
    );
  };

  const handleRevert = (batchShortageId: string) => {
    overrideMutation.mutate({
      batchShortageId,
      batchId: batch.id,
      override: false,
      comment: "",
    });
  };

  const handleEtaChange = (batchShortageId: string, value: string) => {
    etaMutation.mutate({ batchShortageId, eta: value || null });
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Material Availability</h3>

      {/* Raw Materials status row */}
      <div className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          {batch.rmAvailable ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : (
            <CircleAlert className="h-4 w-4 text-red-500" />
          )}
          <span className="font-medium">Raw Materials</span>
        </div>
        <span className={`text-xs font-medium ${batch.rmAvailable ? "text-emerald-600" : "text-red-500"}`}>
          {batch.rmAvailable ? "Available" : "Not Available"}
        </span>
      </div>

      {/* Packaging status row */}
      <div className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          {batch.packagingAvailable ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : (
            <CircleAlert className="h-4 w-4 text-red-500" />
          )}
          <span className="font-medium">Packaging</span>
        </div>
        <span className={`text-xs font-medium ${batch.packagingAvailable ? "text-emerald-600" : "text-red-500"}`}>
          {batch.packagingAvailable ? "Available" : batch.packagingAvailable === false ? "Not Available" : "Pending"}
        </span>
      </div>

      {/* Fallback: flag set but no shortage detail records exist */}
      {activeShortages.length === 0 && (!batch.rmAvailable || !batch.packagingAvailable) && (
        <div className="rounded-md border border-amber-200 bg-amber-50/50 px-3 py-2 text-xs text-amber-800">
          Shortage details unavailable — re-import with SOH/Requirements data to populate.
        </div>
      )}

      {/* Shortages header + flat table */}
      {activeShortages.length > 0 && (
        <div className="space-y-0">
          <div className="flex items-center justify-between rounded-t-md border border-b-0 border-red-200 bg-red-50/50 px-3 py-2">
            <div className="flex items-center gap-3">
              <Badge variant="destructive" className="px-2 py-0.5 text-xs font-bold">
                {unresolvedCount} SHORTAGES
              </Badge>
              <span className="text-xs text-muted-foreground">
                SOH insufficient for requirements
              </span>
            </div>
            {canOverride && (
              <div className="flex items-center gap-2">
                <Label htmlFor="batch-planner-override-toggle" className="text-xs text-muted-foreground">
                  Planner Override
                </Label>
                <Switch
                  id="batch-planner-override-toggle"
                  checked={overrideMode}
                  onCheckedChange={setOverrideMode}
                />
              </div>
            )}
          </div>
          <ShortageTable
            shortages={activeShortages}
            canOverride={canOverride}
            overrideMode={overrideMode}
            onOverride={setOverrideTarget}
            onRevert={handleRevert}
            onEtaChange={handleEtaChange}
          />
        </div>
      )}

      {/* Purchasing Comments (override comments) */}
      {activeShortages.some((bs) => bs.overrideComment) && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">Purchasing Comments</p>
          {activeShortages
            .filter((bs) => bs.overrideComment)
            .map((bs) => (
              <div key={bs.id} className="rounded-md bg-muted p-2 text-xs">
                <span className="font-medium">{bs.shortage.materialCode}:</span>{" "}
                {bs.overrideComment}
              </div>
            ))}
        </div>
      )}

      {/* Override dialog */}
      <Dialog open={overrideTarget !== null} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Override Shortage</DialogTitle>
            <DialogDescription>
              Override shortage for{" "}
              <span className="font-medium">{overrideTarget?.materialCode ?? "—"}</span> on
              batch <span className="font-medium">{batch.sapOrder}</span>.
              Short by{" "}
              <span className="font-semibold text-red-600">
                {overrideTarget?.shortQty.toLocaleString()} {overrideTarget?.uom}
              </span>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Reason</Label>
              <div className="space-y-2">
                {OVERRIDE_REASONS.map((reason) => (
                  <label key={reason} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="batch-override-reason"
                      value={reason}
                      checked={selectedReason === reason}
                      onChange={() => handleReasonChange(reason)}
                      className="accent-primary"
                    />
                    {reason}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="batch-override-comment" className="text-xs">
                Comment {selectedReason === "Other" && "(required)"}
              </Label>
              <Textarea
                id="batch-override-comment"
                placeholder={
                  selectedReason === "Other"
                    ? "Enter override reason..."
                    : "Add additional details (optional)..."
                }
                value={overrideComment}
                onChange={(e) => setOverrideComment(e.target.value)}
                rows={2}
                className="text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button
              onClick={handleConfirm}
              disabled={!selectedReason || !overrideComment.trim() || overrideMutation.isPending}
            >
              {overrideMutation.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Confirm Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


function CoverageSection({ batch }: { batch: Batch }) {
  const { data: coverageItems = [], isLoading } = useBatchCoverage(batch.id);

  // Fallback to legacy aggregated view if no per-plant items exist
  const hasLegacyData = batch.stockCover != null || batch.safetyStock != null || batch.forecast != null;
  if (!isLoading && coverageItems.length === 0 && !hasLegacyData) return null;

  // Per-plant breakdown
  if (coverageItems.length > 0) {
    const oosCount = coverageItems.filter((i) => i.level === "Stock Out").length;
    const critCount = coverageItems.filter((i) => i.level === "Critical").length;
    const lowCount = coverageItems.filter((i) => i.level === "Low").length;
    const goodCount = coverageItems.filter((i) => i.level === "Good").length;
    const total = coverageItems.length;

    // Overall level = worst item
    const overallLevel = coverageItems[0]!.level;
    const isOos = overallLevel === "Stock Out";
    const isCrit = overallLevel === "Critical";
    const isLow = overallLevel === "Low";

    // Attention items: OOS and Critical
    const attentionItems = coverageItems.filter(
      (i) => i.level === "Stock Out" || i.level === "Critical" || i.level === "Low",
    );

    const overallColor = isOos
      ? "bg-red-50 border-red-200"
      : isCrit
        ? "bg-orange-50 border-orange-200"
        : isLow
          ? "bg-amber-50 border-amber-200"
          : "bg-green-50 border-green-200";

    const overallDot = isOos
      ? "bg-red-500"
      : isCrit
        ? "bg-orange-500"
        : isLow
          ? "bg-amber-500"
          : "bg-emerald-500";

    const overallText = isOos
      ? "text-red-700"
      : isCrit
        ? "text-orange-700"
        : isLow
          ? "text-amber-700"
          : "text-green-700";

    const overallLabel = isOos
      ? "Stock Out"
      : isCrit
        ? "Critical"
        : isLow
          ? "Low Coverage"
          : "Good";

    return (
      <div className={`space-y-3 rounded-lg border p-3 ${overallColor}`}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${isOos || isCrit ? "bg-red-100 text-red-700" : isLow ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>
              COV
            </span>
            <h3 className="text-sm font-semibold">Coverage Profile</h3>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${overallDot}`} />
            <span className={`text-xs font-semibold ${overallText}`}>
              {overallLabel}
            </span>
            <span className="text-xs text-muted-foreground">
              ({total} FG{total !== 1 ? "s" : ""})
            </span>
          </div>
        </div>

        {/* Stacked bar */}
        <div className="flex h-7 w-full overflow-hidden rounded-md">
          {goodCount > 0 && (
            <div
              className="flex items-center justify-center bg-green-200 text-[10px] font-semibold text-green-800 transition-all"
              style={{ width: `${(goodCount / total) * 100}%` }}
            >
              {goodCount} Good
            </div>
          )}
          {lowCount > 0 && (
            <div
              className="flex items-center justify-center bg-amber-200 text-[10px] font-semibold text-amber-800 transition-all"
              style={{ width: `${(lowCount / total) * 100}%` }}
            >
              {lowCount} Low
            </div>
          )}
          {critCount > 0 && (
            <div
              className="flex items-center justify-center bg-orange-200 text-[10px] font-semibold text-orange-800 transition-all"
              style={{ width: `${(critCount / total) * 100}%` }}
            >
              {critCount} Crit
            </div>
          )}
          {oosCount > 0 && (
            <div
              className="flex items-center justify-center bg-red-200 text-[10px] font-semibold text-red-800 transition-all"
              style={{ width: `${(oosCount / total) * 100}%` }}
            >
              {oosCount} Stock Out
            </div>
          )}
        </div>

        {/* Attention Required */}
        {attentionItems.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Attention Required
            </p>
            {attentionItems.map((item, i) => {
              const isItemOos = item.level === "Stock Out";
              const isItemCrit = item.level === "Critical";
              return (
                <div
                  key={`${item.planningMaterial}-${item.plant}-${i}`}
                  className="flex items-center gap-2 rounded border bg-white/80 px-2 py-1.5 text-xs"
                >
                  <span
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                      isItemOos ? "bg-red-500" : isItemCrit ? "bg-orange-500" : "bg-amber-500"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-semibold">
                        {item.material || item.planningMaterial}
                      </span>
                      <span className="truncate text-muted-foreground">
                        {item.description}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-right tabular-nums">
                    {item.plant && (
                      <span className="text-muted-foreground">{item.plant}</span>
                    )}
                    <span className={isItemOos ? "font-semibold text-red-700" : isItemCrit ? "font-semibold text-orange-700" : "font-semibold text-amber-700"}>
                      {item.stockCover.toFixed(0)}d
                    </span>
                    <span className="text-muted-foreground">
                      {item.availableStock.toLocaleString()} units
                    </span>
                  </div>
                  {isItemOos && item.nextPoOrder && (
                    <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-700">
                      PO: {item.nextPoOrder}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Legacy fallback (no per-plant data)
  const coverWeeks = batch.stockCover ?? 0;
  const maxWeeks = 52;
  const pct = Math.min(100, (coverWeeks / maxWeeks) * 100);
  const isStockOut = coverWeeks <= 0;
  const isLowLegacy = coverWeeks > 0 && coverWeeks < 4;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Coverage Profile</h3>
        {isStockOut && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <CircleAlert className="h-3.5 w-3.5 text-red-500" />
            Stock Out
          </span>
        )}
        {isLowLegacy && !isStockOut && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            Low Cover
          </span>
        )}
        {!isStockOut && !isLowLegacy && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            Good
          </span>
        )}
      </div>

      <div className="h-5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${
            isStockOut
              ? "bg-red-400"
              : isLowLegacy
                ? "bg-amber-400"
                : "bg-emerald-400"
          }`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-xs text-muted-foreground">Stock Cover</p>
          <p className="text-sm font-semibold">
            {batch.stockCover != null ? `${batch.stockCover}w` : "\u2014"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Safety Stock</p>
          <p className="text-sm font-semibold">
            {batch.safetyStock != null ? batch.safetyStock.toLocaleString() : "\u2014"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Forecast</p>
          <p className="text-sm font-semibold">
            {batch.forecast != null ? batch.forecast.toLocaleString() : "\u2014"}
          </p>
        </div>
      </div>
    </div>
  );
}

function QcControlsSection({
  batch,
  canEdit,
  onUpdate,
  onFieldUpdate,
}: {
  batch: Batch;
  canEdit: boolean;
  onUpdate: (field: string, value: boolean) => void;
  onFieldUpdate: (field: string, value: string | null) => void;
}) {
  const [obsComment, setObsComment] = useState(batch.observationComment ?? "");
  const [ebrComment, setEbrComment] = useState(batch.ebrComment ?? "");
  const obsTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const ebrTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Sync local state when batch data changes from server
  useEffect(() => { setObsComment(batch.observationComment ?? ""); }, [batch.observationComment]);
  useEffect(() => { setEbrComment(batch.ebrComment ?? ""); }, [batch.ebrComment]);

  // Cleanup timers
  useEffect(() => () => { clearTimeout(obsTimerRef.current); clearTimeout(ebrTimerRef.current); }, []);

  const handleObsChange = (value: string) => {
    setObsComment(value);
    clearTimeout(obsTimerRef.current);
    obsTimerRef.current = setTimeout(() => onFieldUpdate("observationComment", value || null), 500);
  };

  const handleEbrChange = (value: string) => {
    setEbrComment(value);
    clearTimeout(ebrTimerRef.current);
    ebrTimerRef.current = setTimeout(() => onFieldUpdate("ebrComment", value || null), 500);
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">QC / P&C Controls</h3>
      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-md border px-3 py-2">
          <span className="text-sm">Observation Required</span>
          <Switch
            checked={batch.observationRequired}
            onCheckedChange={(checked) => onUpdate("observationRequired", checked)}
            disabled={!canEdit}
          />
        </div>
        {batch.observationRequired && (
          <div className="ml-1 border-l-2 border-purple-200 pl-3">
            <Textarea
              placeholder="Enter observation details..."
              value={obsComment}
              onChange={(e) => handleObsChange(e.target.value)}
              disabled={!canEdit}
              rows={2}
              className="text-xs"
            />
          </div>
        )}
        <div className="flex items-center justify-between rounded-md border px-3 py-2">
          <span className="text-sm">EBR Batch</span>
          <Switch
            checked={batch.ebrBatch}
            onCheckedChange={(checked) => onUpdate("ebrBatch", checked)}
            disabled={!canEdit}
          />
        </div>
        {batch.ebrBatch && (
          <div className="ml-1 border-l-2 border-indigo-200 pl-3">
            <Textarea
              placeholder="Enter EBR details..."
              value={ebrComment}
              onChange={(e) => handleEbrChange(e.target.value)}
              disabled={!canEdit}
              rows={2}
              className="text-xs"
            />
          </div>
        )}
      </div>
      {batch.qcObservedStage && (
        <div className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
          <p>
            <span className="font-medium">Stage:</span> {batch.qcObservedStage}
          </p>
          {batch.qcObservedBy && (
            <p>
              <span className="font-medium">By:</span> {batch.qcObservedBy}
            </p>
          )}
          {batch.qcObservedAt && (
            <p>
              <span className="font-medium">At:</span> {formatDateTime(batch.qcObservedAt)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function BatchDetailSheet({
  batchId,
  open,
  onOpenChange,
  resources,
  onReschedule,
}: BatchDetailSheetProps) {
  const { data: batch, isLoading } = useBatch(batchId);
  const { data: fillOrders = [] } = useQuery<LinkedFillOrder[]>({
    queryKey: ["linked_fill_orders", batchId],
    queryFn: async () => {
      if (!batchId) return [];
      const { data, error } = await supabase
        .from("linked_fill_orders")
        .select("*")
        .eq("batch_id", batchId);
      if (error) throw error;
      const mapped = (data ?? []).map((r: Record<string, unknown>) =>
        mapLinkedFillOrder(r as DatabaseRow["linked_fill_orders"])
      );
      // Deduplicate by fill order number — keep first occurrence
      const seen = new Set<string>();
      return mapped.filter((fo) => {
        if (!fo.fillOrder) return true;
        if (seen.has(fo.fillOrder)) return false;
        seen.add(fo.fillOrder);
        return true;
      });
    },
    enabled: !!batchId,
  });
  const updateBatch = useUpdateBatch();
  const addAudit = useAddAuditEntry();
  const deleteBatch = useDeleteBatch();
  const { hasPermission } = usePermissions();
  const { user } = useCurrentSite();

  // Bulk alerts for this batch
  const alertsForBatch = useAlertsForBatch(
    batch?.id ?? null,
    batch?.bulkCode ?? null,
    batch?.planDate ?? null,
  );
  const { data: allBatches = [] } = useBatches();

  const canEditStatus = hasPermission("batches.status");
  const canEditSchedule = hasPermission("batches.schedule");

  // Status comment modal state
  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<BatchStatus | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const canDeleteBatch = canEditSchedule;

  const resource = batch?.planResourceId
    ? resources.find((r) => r.id === batch.planResourceId)
    : null;
  const disperser = batch?.planDisperserId
    ? resources.find((r) => r.id === batch.planDisperserId)
    : null;
  const disperser2 = batch?.planDisperser2Id
    ? resources.find((r) => r.id === batch.planDisperser2Id)
    : null;

  // Compute fill summary from linked orders
  const fillSummary =
    fillOrders.length > 0
      ? (() => {
          const totalQty = fillOrders.reduce((sum, fo) => sum + (fo.quantity ?? 0), 0);
          const packSizes = [...new Set(fillOrders.map((fo) => fo.packSize).filter(Boolean))];
          return packSizes.length > 0
            ? `${packSizes.join(", ")} \u00D7 ${totalQty.toLocaleString()}`
            : totalQty > 0
              ? totalQty.toLocaleString()
              : null;
        })()
      : null;

  const handleStatusChange = (newStatus: string) => {
    if (!batch) return;
    const status = newStatus as BatchStatus;
    if (status === batch.status) return;

    // Statuses that need the comment modal (required or optional)
    if (
      COMMENT_REQUIRED_STATUSES.includes(status) ||
      OPTIONAL_COMMENT_STATUSES.includes(status)
    ) {
      setPendingStatus(status);
      setCommentModalOpen(true);
      return;
    }

    updateBatch.mutate(
      { batchId: batch.id, updates: { status } },
      {
        onSuccess: () => {
          addAudit.mutate({
            batchId: batch.id,
            action: "status_change",
            details: {
              from: batch.status,
              to: status,
              changed_by: user?.email ?? user?.id ?? "unknown",
            },
          });
          toast.success(`Status changed to ${status}`);
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : "Failed to update status");
        },
      },
    );
  };

  const handleCommentConfirm = (data: {
    comment: string;
    excessPaintComment?: string;
    bulkOffComment?: string;
  }) => {
    if (!batch || !pendingStatus) return;

    const updates: Record<string, unknown> = {
      status: pendingStatus,
    };

    // Only set statusComment if provided
    if (data.comment) {
      updates.statusComment = data.comment;
    }

    // OFF Rework: optional bulk off comment
    if (data.bulkOffComment) {
      updates.bulkOffComment = data.bulkOffComment;
    }

    // Job Complete: optional excess paint comment
    if (data.excessPaintComment) {
      updates.excessPaintComment = data.excessPaintComment;
    }

    updateBatch.mutate(
      {
        batchId: batch.id,
        updates: updates as never,
      },
      {
        onSuccess: () => {
          addAudit.mutate({
            batchId: batch.id,
            action: "status_change",
            details: {
              from: batch.status,
              to: pendingStatus,
              ...(data.comment ? { comment: data.comment } : {}),
              ...(data.excessPaintComment
                ? { excess_paint: data.excessPaintComment }
                : {}),
              ...(data.bulkOffComment
                ? { bulk_off: data.bulkOffComment }
                : {}),
              changed_by: user?.email ?? user?.id ?? "unknown",
            },
          });
          toast.success(`Status changed to ${pendingStatus}`);
          setCommentModalOpen(false);
          setPendingStatus(null);
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : "Failed to update status");
        },
      },
    );
  };

  const handleFieldUpdate = (field: string, value: unknown) => {
    if (!batch) return;
    updateBatch.mutate(
      { batchId: batch.id, updates: { [field]: value } },
      {
        onSuccess: () => {
          addAudit.mutate({
            batchId: batch.id,
            action: "field_update",
            details: {
              field,
              value,
              changed_by: user?.email ?? user?.id ?? "unknown",
            },
          });
        },
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto pb-16 sm:max-w-3xl">
        {isLoading ? (
          <div className="space-y-4 pt-6">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : batch ? (
          <>
            {/* Header */}
            <SheetHeader>
              <SheetTitle className="text-lg">
                Batch: {batch.sapOrder}
              </SheetTitle>
              <SheetDescription className="text-sm">
                {batch.materialDescription ?? "No description"}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-5">
              {/* Bulk alert banner */}
              <BulkAlertBanner alerts={alertsForBatch} batches={allBatches} />

              {/* Status alert banner */}
              <StatusAlertBanner batch={batch} />

              {/* Current Status + Physical Location */}
              <div className="rounded-lg border p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Current Status</h3>
                  {canEditStatus ? (
                    <StatusSelect
                      value={batch.status}
                      onValueChange={handleStatusChange}
                      disabled={updateBatch.isPending}
                    />
                  ) : (
                    <StatusBadge
                      status={batch.status}
                      showExcess={!!batch.excessPaintComment}
                    />
                  )}
                </div>

                <PhysicalLocationChips
                  batch={batch}
                  canEdit={canEditStatus}
                  onUpdate={(loc) => handleFieldUpdate("physicalLocation", loc)}
                />
              </div>

              {/* Reschedule action for blocked batches */}
              {(!batch.rmAvailable || !batch.packagingAvailable) &&
                canEditSchedule &&
                onReschedule && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      onReschedule(batch.id);
                      onOpenChange(false);
                    }}
                  >
                    <CalendarClock className="h-3.5 w-3.5" />
                    Reschedule
                  </Button>
                )}

              {/* Delete batch (admins only) */}
              {canDeleteBatch && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10"
                  onClick={() => setDeleteConfirmOpen(true)}
                  disabled={deleteBatch.isPending}
                >
                  {deleteBatch.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Delete Batch
                </Button>
              )}

              {/* Two-column: Bulk Information / Fill Information */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Bulk Information */}
                <div className="rounded-lg border p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] font-bold">
                      BULK
                    </Badge>
                    <h3 className="text-sm font-semibold">Bulk Information</h3>
                  </div>
                  <div className="divide-y">
                    <InfoRow label="Bulk Code" value={batch.bulkCode} />
                    <InfoRow label="Bulk Batch Number" value={batch.bulkBatchNumber ?? batch.sapOrder} />
                    <InfoRow label="Colour" value={batch.sapColorGroup} />
                    <InfoRow label="Premix Count" value={batch.premixCount} />
                    <InfoRow
                      label="Volume"
                      value={
                        batch.batchVolume != null
                          ? `${batch.batchVolume.toLocaleString()}L`
                          : null
                      }
                    />
                    <InfoRow
                      label="Mixer"
                      value={resource ? (resource.displayName ?? resource.resourceCode) : "Unassigned"}
                    />
                    <InfoRow
                      label={disperser2 ? "Dispersion 1" : "Disperser"}
                      value={disperser ? (disperser.displayName ?? disperser.resourceCode) : "None"}
                    />
                    {disperser2 && (
                      <InfoRow
                        label="Dispersion 2"
                        value={disperser2.displayName ?? disperser2.resourceCode}
                      />
                    )}
                  </div>
                  {resource && batch.batchVolume != null && resource.maxCapacity != null && (
                    <div className="mt-2 text-[10px] text-muted-foreground">
                      Capacity: {resource.minCapacity?.toLocaleString() ?? "?"}L
                      {" \u2014 "}{resource.maxCapacity.toLocaleString()}L
                      {batch.batchVolume > resource.maxCapacity && (
                        <span className="ml-1 font-semibold text-red-500">
                          (over by {(batch.batchVolume - resource.maxCapacity).toLocaleString()}L)
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Fill Information */}
                <div className="rounded-lg border p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] font-bold">
                      FILL
                    </Badge>
                    <h3 className="text-sm font-semibold">Fill Information</h3>
                  </div>
                  <div className="divide-y">
                    {fillSummary && (
                      <div className="rounded-md border bg-muted/50 px-2 py-1.5 text-xs font-medium mb-1">
                        Pack Summary: {fillSummary}
                      </div>
                    )}
                    <InfoRow label="Material Code" value={batch.materialCode} />
                    {fillOrders.length === 1 && fillOrders[0]?.fillOrder && (
                      <InfoRow label="SAP Fill Order" value={fillOrders[0].fillOrder} />
                    )}
                    {fillOrders.length > 1 && (
                      <InfoRow
                        label={`SAP Fill Orders (${fillOrders.length})`}
                        value={fillOrders
                          .map((fo) => fo.fillOrder)
                          .filter(Boolean)
                          .join(", ")}
                      />
                    )}
                    <InfoRow label="Pack Size" value={batch.packSize} />
                    {fillOrders.length > 0 && (
                      <InfoRow
                        label="Quantity"
                        value={`${fillOrders.reduce((s, fo) => s + (fo.quantity ?? 0), 0).toLocaleString()} units`}
                      />
                    )}
                    {(() => {
                      const hasRedLid = fillOrders.some((fo) =>
                        fillOrderHasComponent(
                          { components: fo.components, fillMaterial: fo.fillMaterial, lidType: fo.lidType },
                          RED_LID_COMPONENT,
                        ),
                      );
                      const hasBlueLid = fillOrders.some((fo) =>
                        fillOrderHasComponent(
                          { components: fo.components, fillMaterial: fo.fillMaterial, lidType: fo.lidType },
                          BLUE_LID_COMPONENT,
                        ),
                      );
                      if (!hasRedLid && !hasBlueLid) {
                        const lidTypes = [...new Set(fillOrders.map((fo) => fo.lidType).filter(Boolean))];
                        return lidTypes.length > 0 ? (
                          <InfoRow label="Lid Type" value={lidTypes.join(", ")} />
                        ) : null;
                      }
                      return (
                        <InfoRow
                          label="Lid Type"
                          value={
                            <div className="flex items-center gap-1 flex-wrap justify-end">
                              {hasRedLid && (
                                <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">
                                  Red Lid
                                </span>
                              )}
                              {hasBlueLid && (
                                <span className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                                  Blue Lid
                                </span>
                              )}
                            </div>
                          }
                        />
                      );
                    })()}
                    {/* Fill Category pills: 500ml / Manual */}
                    {(() => {
                      const litres = parsePackSizeLitres(batch.packSize);
                      if (litres === 0.5) {
                        return (
                          <InfoRow
                            label="Fill Category"
                            value={
                              <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                                500ml
                              </span>
                            }
                          />
                        );
                      }
                      if (litres !== null && litres > 40) {
                        return (
                          <InfoRow
                            label="Fill Category"
                            value={
                              <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700 dark:bg-orange-950 dark:text-orange-300">
                                Manual Fill
                              </span>
                            }
                          />
                        );
                      }
                      return null;
                    })()}
                    {(() => {
                      const fill = getFillLabel(batch);
                      return (
                        <InfoRow
                          label="Fill Requirement"
                          value={
                            <span
                              className={
                                fill.includes("24")
                                  ? "inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950 dark:text-red-300"
                                  : fill.includes("48")
                                    ? "inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                                    : ""
                              }
                            >
                              {fill}
                            </span>
                          }
                        />
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Linked Fill Orders table */}
              {fillOrders.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">
                      Linked Fill Orders ({fillOrders.length})
                    </h3>
                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">
                              SAP Order
                            </th>
                            <th className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">
                              Material
                            </th>
                            <th className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">
                              Pack Size
                            </th>
                            <th className="px-3 py-1.5 text-right text-xs font-medium text-muted-foreground">
                              Quantity
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {fillOrders.map((fo) => (
                            <tr key={fo.id} className="border-b last:border-0">
                              <td className="px-3 py-1.5 text-xs">
                                {fo.fillOrder ?? "\u2014"}
                              </td>
                              <td className="px-3 py-1.5 text-xs text-muted-foreground">
                                {fo.fillMaterial ?? "\u2014"}
                              </td>
                              <td className="px-3 py-1.5 text-xs">
                                {fo.packSize ?? "\u2014"}
                              </td>
                              <td className="px-3 py-1.5 text-right text-xs font-medium">
                                {fo.quantity != null
                                  ? fo.quantity.toLocaleString()
                                  : "\u2014"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}

              <Separator />

              {/* Material Availability & Shortages */}
              <MaterialAvailabilitySection batch={batch} canOverride={hasPermission("planning.vet")} />

              {/* Coverage Profile */}
              <CoverageSection batch={batch} />

              {/* Purchase Orders */}
              {(batch.poDate || batch.poQuantity != null) && (
                <>
                  <Separator />
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">Purchase Order</h3>
                    <div className="divide-y rounded-md border p-3">
                      <InfoRow label="PO Date" value={formatDate(batch.poDate)} />
                      <InfoRow
                        label="PO Quantity"
                        value={
                          batch.poQuantity != null
                            ? batch.poQuantity.toLocaleString()
                            : null
                        }
                      />
                    </div>
                  </div>
                </>
              )}

              <Separator />

              {/* QC / P&C Controls */}
              <QcControlsSection
                batch={batch}
                canEdit={canEditStatus}
                onUpdate={(field, value) => handleFieldUpdate(field, value)}
                onFieldUpdate={(field, value) => handleFieldUpdate(field, value)}
              />

              {/* Vetting */}
              {batch.vettingStatus !== "not_required" && (
                <>
                  <Separator />
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">Vetting</h3>
                    <div className="space-y-1 rounded-md border p-3">
                      <InfoRow
                        label="Status"
                        value={
                          <span className="capitalize">{batch.vettingStatus}</span>
                        }
                      />
                      {batch.vettedBy && (
                        <InfoRow label="Vetted By" value={batch.vettedBy} />
                      )}
                      {batch.vettedAt && (
                        <InfoRow
                          label="Vetted At"
                          value={formatDateTime(batch.vettedAt)}
                        />
                      )}
                    </div>
                    {batch.vettingComment && (
                      <div className="mt-2 rounded-md bg-muted p-2 text-sm">
                        {batch.vettingComment}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Status comment */}
              {batch.statusComment && (
                <>
                  <Separator />
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">Status Comment</h3>
                    <p className="rounded-md bg-muted p-3 text-sm">
                      {batch.statusComment}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {batch.statusChangedBy && `By ${batch.statusChangedBy}`}
                      {batch.statusChangedAt &&
                        ` on ${formatDateTime(batch.statusChangedAt)}`}
                    </p>
                  </div>
                </>
              )}

              {/* Bulk off comment (OFF Rework) */}
              {batch.bulkOffComment && (
                <>
                  <Separator />
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">Bulk Off Details</h3>
                    <p className="rounded-md bg-muted p-3 text-sm">
                      {batch.bulkOffComment}
                    </p>
                  </div>
                </>
              )}

              {/* Excess paint comment (Job Complete) */}
              {batch.excessPaintComment && (
                <>
                  <Separator />
                  <div>
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                      Excess Paint
                      <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                        EXCESS
                      </span>
                    </h3>
                    <p className="rounded-md bg-muted p-3 text-sm">
                      {batch.excessPaintComment}
                    </p>
                  </div>
                </>
              )}

              {/* Job location */}
              {batch.jobLocation && (
                <>
                  <Separator />
                  <div className="flex items-start gap-3 py-2">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Job Location</p>
                      <p className="text-sm">{batch.jobLocation}</p>
                    </div>
                  </div>
                </>
              )}

              {/* Audit trail */}
              <Separator />
              <div>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <History className="h-4 w-4" />
                  Activity
                </h3>
                <AuditLog batchId={batch.id} />
              </div>
            </div>

            {/* Status comment modal */}
            {pendingStatus && (
              <StatusCommentModal
                open={commentModalOpen}
                onOpenChange={(open) => {
                  setCommentModalOpen(open);
                  if (!open) setPendingStatus(null);
                }}
                batchId={batch.id}
                sapOrder={batch.sapOrder}
                newStatus={pendingStatus}
                onConfirm={handleCommentConfirm}
              />
            )}

            {/* Delete batch confirmation */}
            <ConfirmDialog
              open={deleteConfirmOpen}
              onOpenChange={setDeleteConfirmOpen}
              title={`Delete Batch ${batch.sapOrder}?`}
              description={`This will permanently remove batch ${batch.sapOrder} (${batch.materialDescription ?? "no description"}) and all its linked fill orders from the schedule. This cannot be undone.`}
              confirmLabel="Delete Batch"
              variant="destructive"
              onConfirm={() => {
                deleteBatch.mutate(batch.id, {
                  onSuccess: () => {
                    setDeleteConfirmOpen(false);
                    onOpenChange(false);
                  },
                });
              }}
            />
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Batch not found
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
