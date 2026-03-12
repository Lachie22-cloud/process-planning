import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { PermissionGate } from "@/components/shared/permission-gate";
import { VettingStatusBadge } from "./vetting-status-badge";
import {
  useVetBatch,
  useBulkVet,
  useManualShortageOverride,
  ALLOWED_TRANSITIONS,
} from "@/hooks/use-vetting";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import type { Batch, VettingStatus } from "@/types/batch";

type StatusFilter = "needs_vetting" | "all" | VettingStatus;

interface VettingPanelProps {
  batches: Batch[];
}

export function VettingPanel({ batches }: VettingPanelProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkComment, setBulkComment] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("needs_vetting");
  const [overrideBatch, setOverrideBatch] = useState<Batch | null>(null);
  const [overrideComment, setOverrideComment] = useState("");
  const [manualSohConfirmed, setManualSohConfirmed] = useState(false);

  const vetBatch = useVetBatch();
  const bulkVet = useBulkVet();
  const manualShortageOverride = useManualShortageOverride();

  // Apply status filter
  const filteredBatches = useMemo(() => {
    let filtered: Batch[];
    if (statusFilter === "needs_vetting") {
      filtered = batches.filter(
        (b) => b.vettingStatus === "pending" || b.vettingStatus === "rejected",
      );
    } else if (statusFilter === "all") {
      filtered = [...batches];
    } else {
      filtered = batches.filter((b) => b.vettingStatus === statusFilter);
    }

    return filtered.sort((a, b) => {
      // Pending first, then rejected, then approved, then not_required
      const order: Record<VettingStatus, number> = {
        pending: 0,
        rejected: 1,
        approved: 2,
        not_required: 3,
      };
      const statusDiff = (order[a.vettingStatus] ?? 3) - (order[b.vettingStatus] ?? 3);
      if (statusDiff !== 0) return statusDiff;
      // Then by material shortage, then by plan date
      if (a.materialShortage !== b.materialShortage) {
        return a.materialShortage ? -1 : 1;
      }
      return (a.planDate ?? "").localeCompare(b.planDate ?? "");
    });
  }, [batches, statusFilter]);

  const pendingCount = batches.filter((b) => b.vettingStatus === "pending").length;
  const approvedCount = batches.filter((b) => b.vettingStatus === "approved").length;
  const rejectedCount = batches.filter((b) => b.vettingStatus === "rejected").length;
  const notRequiredCount = batches.filter((b) => b.vettingStatus === "not_required").length;
  const selectedBatches = filteredBatches.filter((b) => selectedIds.has(b.id));

  const canApplyBulkTransition = (target: VettingStatus) => {
    if (selectedBatches.length === 0) return false;
    return selectedBatches.every((batch) => {
      if (batch.vettingStatus === target) return true;
      return ALLOWED_TRANSITIONS[batch.vettingStatus]?.includes(target) ?? false;
    });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === filteredBatches.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredBatches.map((b) => b.id)));
    }
  };

  const handleBulkAction = (vettingStatus: VettingStatus) => {
    if (selectedIds.size === 0) return;
    bulkVet.mutate(
      {
        batchIds: Array.from(selectedIds),
        vettingStatus,
        vettingComment: bulkComment.trim() || null,
      },
      {
        onSuccess: () => {
          setSelectedIds(new Set());
          setBulkComment("");
        },
      },
    );
  };

  const handleSingleVet = (batchId: string, status: VettingStatus, comment: string | null) => {
    vetBatch.mutate({ batchId, vettingStatus: status, vettingComment: comment });
  };

  const openManualOverrideDialog = (batch: Batch) => {
    setOverrideBatch(batch);
    setOverrideComment("");
    setManualSohConfirmed(false);
  };

  const closeManualOverrideDialog = () => {
    setOverrideBatch(null);
    setOverrideComment("");
    setManualSohConfirmed(false);
  };

  const handleManualOverrideConfirm = () => {
    if (!overrideBatch || !manualSohConfirmed) return;
    manualShortageOverride.mutate(
      {
        batchId: overrideBatch.id,
        overrideComment: overrideComment.trim() || null,
      },
      { onSuccess: closeManualOverrideDialog },
    );
  };

  if (batches.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base">Batch Vetting</CardTitle>
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v as StatusFilter);
                setSelectedIds(new Set());
              }}
            >
              <SelectTrigger className="h-7 w-[160px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="needs_vetting">Needs Vetting</SelectItem>
                <SelectItem value="all">All Batches</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="not_required">Not Required</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {pendingCount > 0 && (
              <Badge variant="outline" className="border-amber-300 text-amber-700">
                {pendingCount} Pending
              </Badge>
            )}
            {approvedCount > 0 && (
              <Badge variant="secondary" className="bg-green-100 text-green-700">
                {approvedCount} Approved
              </Badge>
            )}
            {rejectedCount > 0 && (
              <Badge variant="destructive">{rejectedCount} Rejected</Badge>
            )}
            {notRequiredCount > 0 && (
              <Badge variant="secondary">{notRequiredCount} N/A</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Bulk actions (admin only) */}
        <PermissionGate permission="planning.vet">
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-3">
              <span className="text-sm font-medium">
                {selectedIds.size} selected
              </span>
              <Textarea
                placeholder="Bulk comment (optional for approve, required for reject)..."
                value={bulkComment}
                onChange={(e) => setBulkComment(e.target.value)}
                rows={1}
                className="max-w-xs text-xs"
              />
              <Button
                size="sm"
                className="h-7"
                disabled={bulkVet.isPending || !canApplyBulkTransition("approved")}
                onClick={() => handleBulkAction("approved")}
              >
                {bulkVet.isPending ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                )}
                Approve All
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-7"
                disabled={
                  bulkVet.isPending ||
                  !bulkComment.trim() ||
                  !canApplyBulkTransition("rejected")
                }
                onClick={() => handleBulkAction("rejected")}
              >
                <XCircle className="mr-1 h-3 w-3" />
                Reject All
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                disabled={bulkVet.isPending || !canApplyBulkTransition("pending")}
                onClick={() => handleBulkAction("pending")}
              >
                Set Pending
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                disabled={bulkVet.isPending || !canApplyBulkTransition("not_required")}
                onClick={() => handleBulkAction("not_required")}
              >
                Set N/A
              </Button>
            </div>
          )}
        </PermissionGate>

        {(vetBatch.error || bulkVet.error) && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {(vetBatch.error ?? bulkVet.error)?.message ?? "Vetting action failed"}
            </AlertDescription>
          </Alert>
        )}

        {filteredBatches.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {statusFilter === "needs_vetting"
              ? "All batches have been vetted."
              : "No batches match the selected filter."}
          </p>
        ) : (
          <div className="max-h-96 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <PermissionGate permission="planning.vet">
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        checked={
                          selectedIds.size === filteredBatches.length &&
                          filteredBatches.length > 0
                        }
                        onChange={toggleAll}
                        className="accent-primary"
                      />
                    </TableHead>
                  </PermissionGate>
                  <TableHead>Order</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                  <TableHead className="text-right">Cover (days)</TableHead>
                  <TableHead>Shortage</TableHead>
                  <TableHead>Vetting</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBatches.map((batch) => (
                  <TableRow
                    key={batch.id}
                    className={batch.materialShortage ? "bg-red-50/50" : undefined}
                  >
                    <PermissionGate permission="planning.vet">
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(batch.id)}
                          onChange={() => toggleSelect(batch.id)}
                          className="accent-primary"
                        />
                      </TableCell>
                    </PermissionGate>
                    <TableCell className="font-medium">{batch.sapOrder}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {batch.materialCode ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">
                      {batch.materialDescription ?? "—"}
                    </TableCell>
                    <TableCell>{batch.planDate ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {batch.batchVolume?.toLocaleString() ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {batch.stockCover?.toFixed(0) ?? "—"}
                    </TableCell>
                    <TableCell>
                      {batch.materialShortage ? (
                        <div className="flex items-center gap-2">
                          <Badge variant="destructive" className="text-[10px]">
                            Short
                          </Badge>
                          <PermissionGate permission="planning.vet">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[10px]"
                              onClick={() => openManualOverrideDialog(batch)}
                            >
                              Manual Override
                            </Button>
                          </PermissionGate>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">OK</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <VettingStatusBadge
                        status={batch.vettingStatus}
                        onStatusChange={(status, comment) =>
                          handleSingleVet(batch.id, status, comment)
                        }
                        isUpdating={vetBatch.isPending}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog
        open={overrideBatch !== null}
        onOpenChange={(open) => {
          if (!open) closeManualOverrideDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manual Shortage Override</DialogTitle>
            <DialogDescription>
              Confirm the manual SOH check for batch{" "}
              <span className="font-medium">{overrideBatch?.sapOrder ?? "—"}</span> before
              clearing this shortage flag.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={manualSohConfirmed}
                onChange={(e) => setManualSohConfirmed(e.target.checked)}
                className="mt-0.5 accent-primary"
              />
              <span>
                I confirm I have completed a manual SOH check and this batch is no longer
                a shortage.
              </span>
            </label>

            <div className="space-y-1">
              <Label htmlFor="override-comment" className="text-xs">
                Comment (optional)
              </Label>
              <Textarea
                id="override-comment"
                placeholder="Add context for this manual override..."
                value={overrideComment}
                onChange={(e) => setOverrideComment(e.target.value)}
                rows={2}
                className="text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeManualOverrideDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleManualOverrideConfirm}
              disabled={!manualSohConfirmed || manualShortageOverride.isPending}
            >
              {manualShortageOverride.isPending ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : null}
              Confirm Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
