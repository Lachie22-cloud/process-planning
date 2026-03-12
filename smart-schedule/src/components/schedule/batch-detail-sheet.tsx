import { useState } from "react";
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
  Package,
  CircleAlert,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useBatch } from "@/hooks/use-batches";
import type { LinkedFillOrder } from "@/types/batch";
import { useUpdateBatch, useAddAuditEntry } from "@/hooks/use-batch-mutations";
import { usePermissions } from "@/hooks/use-permissions";
import { useCurrentSite } from "@/hooks/use-current-site";
import { COMMENT_REQUIRED_STATUSES } from "@/types/batch";
import type { BatchStatus, Batch } from "@/types/batch";
import type { Resource } from "@/types/resource";
import { BATCH_STATUSES } from "@/lib/constants/statuses";

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
  WOM: "Waiting on raw materials for this batch",
  WOP: "Packaging is not available for this batch",
  Hold: "Batch is on hold pending resolution",
  "On Test": "Batch is undergoing laboratory testing",
  Rework: "Batch requires rework before proceeding",
  NCB: "Non-conforming batch — requires investigation",
  "Bulk Off": "Bulk material has been taken offline",
  "Excess Paint": "Excess paint from production run",
};

function StatusAlertBanner({ batch }: { batch: Batch }) {
  const cfg = BATCH_STATUSES[batch.status];
  const description = STATUS_DESCRIPTIONS[batch.status];

  // Show banner for warning/alert statuses
  if (!description) return null;

  const isError = ["NCB", "Bulk Off"].includes(batch.status);
  const isWarning = ["WOM", "WOP", "Hold", "On Test", "Rework", "Excess Paint"].includes(batch.status);

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
          {cfg?.label}: {batch.status === "WOM" ? "Waiting On Materials" : batch.status === "WOP" ? "Waiting On Packaging" : cfg?.label}
        </p>
        <p className="text-xs text-muted-foreground">
          {description}
        </p>
      </div>
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

function MaterialAvailabilitySection({ batch }: { batch: Batch }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Material Availability</h3>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            {batch.rmAvailable ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <CircleAlert className="h-4 w-4 text-red-500" />
            )}
            <span className="font-medium">Raw Materials</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {batch.rmAvailable ? "Available" : "Shortage"}
          </span>
        </div>
        <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            {batch.packagingAvailable ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <Package className="h-4 w-4 text-amber-500" />
            )}
            <span className="font-medium">Packaging</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {batch.packagingAvailable ? "Available" : "Pending"}
          </span>
        </div>
      </div>
      {batch.materialShortage && (
        <div className="flex items-center gap-2 rounded-md border px-3 py-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
          <span className="text-xs text-muted-foreground">Material shortage flagged</span>
        </div>
      )}
    </div>
  );
}

function CoverageSection({ batch }: { batch: Batch }) {
  const hasData = batch.stockCover != null || batch.safetyStock != null || batch.forecast != null;
  if (!hasData) return null;

  // Visual coverage bar
  const coverWeeks = batch.stockCover ?? 0;
  const maxWeeks = 52; // scale
  const pct = Math.min(100, (coverWeeks / maxWeeks) * 100);
  const isStockOut = coverWeeks <= 0;
  const isLow = coverWeeks > 0 && coverWeeks < 4;

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
        {isLow && !isStockOut && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            Low Cover
          </span>
        )}
        {!isStockOut && !isLow && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            Good
          </span>
        )}
      </div>

      {/* Visual bar */}
      <div className="h-5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${
            isStockOut
              ? "bg-red-400"
              : isLow
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
}: {
  batch: Batch;
  canEdit: boolean;
  onUpdate: (field: string, value: boolean) => void;
}) {
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
        <div className="flex items-center justify-between rounded-md border px-3 py-2">
          <span className="text-sm">EBR Batch</span>
          <Switch
            checked={batch.ebrBatch}
            onCheckedChange={(checked) => onUpdate("ebrBatch", checked)}
            disabled={!canEdit}
          />
        </div>
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
      return (data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string,
        batchId: r.batch_id as string,
        siteId: r.site_id as string,
        fillOrder: r.fill_order as string | null,
        fillMaterial: r.fill_material as string | null,
        fillDescription: r.fill_description as string | null,
        packSize: r.pack_size as string | null,
        quantity: r.quantity as number | null,
        unit: r.unit as string | null,
        lidType: r.lid_type as string | null,
      }));
    },
    enabled: !!batchId,
  });
  const updateBatch = useUpdateBatch();
  const addAudit = useAddAuditEntry();
  const { hasPermission } = usePermissions();
  const { user } = useCurrentSite();

  const canEditStatus = hasPermission("batches.status");
  const canEditSchedule = hasPermission("batches.schedule");

  // Status comment modal state
  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<BatchStatus | null>(null);

  const resource = batch?.planResourceId
    ? resources.find((r) => r.id === batch.planResourceId)
    : null;
  const disperser = batch?.planDisperserId
    ? resources.find((r) => r.id === batch.planDisperserId)
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

    if (COMMENT_REQUIRED_STATUSES.includes(status)) {
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

  const handleCommentConfirm = (comment: string) => {
    if (!batch || !pendingStatus) return;

    updateBatch.mutate(
      {
        batchId: batch.id,
        updates: { status: pendingStatus, statusComment: comment },
      },
      {
        onSuccess: () => {
          addAudit.mutate({
            batchId: batch.id,
            action: "status_change",
            details: {
              from: batch.status,
              to: pendingStatus,
              comment,
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
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
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
                    <StatusBadge status={batch.status} />
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
                      label="Disperser"
                      value={disperser ? (disperser.displayName ?? disperser.resourceCode) : "None"}
                    />
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
                    {fillOrders[0]?.fillOrder && (
                      <InfoRow label="SAP Fill Order" value={fillOrders[0].fillOrder} />
                    )}
                    <InfoRow label="Pack Size" value={batch.packSize} />
                    {fillOrders.length > 0 && (
                      <InfoRow
                        label="Quantity"
                        value={`${fillOrders.reduce((s, fo) => s + (fo.quantity ?? 0), 0).toLocaleString()} units`}
                      />
                    )}
                    {fillOrders[0]?.lidType && (
                      <InfoRow label="Lid Type" value={fillOrders[0].lidType} />
                    )}
                    <InfoRow label="Fill Requirement" value={batch.fillRequirement ?? "Standard"} />
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

              {/* Material Availability */}
              <MaterialAvailabilitySection batch={batch} />

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
