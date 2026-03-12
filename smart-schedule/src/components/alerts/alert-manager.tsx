import { useMemo, useState, useCallback } from "react";
import { format } from "date-fns";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertBanner } from "./alert-banner";
import { AlertForm } from "./alert-form";
import {
  useAlerts,
  useCreateAlert,
  useUpdateAlert,
  useDeleteAlert,
} from "@/hooks/use-alerts";
import { useBatches } from "@/hooks/use-batches";
import { useCurrentSite } from "@/hooks/use-current-site";
import type { BulkAlert } from "@/types/alert";
import type { BulkAlertFormInput } from "@/lib/validators/alert";

interface AlertManagerProps {
  mode?: "banner" | "manager";
  activeOnly?: boolean;
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "Always";
  try {
    return format(new Date(dateStr), "d MMM yyyy");
  } catch {
    return dateStr;
  }
}

function isAlertActive(alert: BulkAlert, todayISO: string) {
  const starts = !alert.startDate || alert.startDate <= todayISO;
  const ends = !alert.endDate || alert.endDate >= todayISO;
  return starts && ends;
}

export function AlertManager({ mode = "banner", activeOnly = false }: AlertManagerProps) {
  const { user } = useCurrentSite();
  const canWrite = user?.role === "site_admin" || user?.role === "super_admin";

  const { data: alerts = [], isLoading } = useAlerts({ activeOnly });
  const { data: batches = [] } = useBatches();

  const createAlert = useCreateAlert();
  const updateAlert = useUpdateAlert();
  const deleteAlert = useDeleteAlert();

  const [formOpen, setFormOpen] = useState(false);
  const [editingAlert, setEditingAlert] = useState<BulkAlert | null>(null);

  const todayISO = new Date().toISOString().slice(0, 10);
  const activeCount = useMemo(
    () => alerts.filter((a) => isAlertActive(a, todayISO)).length,
    [alerts, todayISO],
  );

  const closeForm = () => {
    setFormOpen(false);
    setEditingAlert(null);
  };

  const handleCreate = (input: BulkAlertFormInput) => {
    createAlert.mutate(input, { onSuccess: closeForm });
  };

  const handleUpdate = (input: BulkAlertFormInput) => {
    if (!editingAlert) return;
    updateAlert.mutate({ id: editingAlert.id, ...input }, { onSuccess: closeForm });
  };

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const handleDelete = useCallback((id: string) => {
    setPendingDeleteId(id);
    setDeleteConfirmOpen(true);
  }, []);

  const confirmDelete = useCallback(() => {
    if (pendingDeleteId) deleteAlert.mutate(pendingDeleteId);
  }, [pendingDeleteId, deleteAlert]);

  if (mode === "banner") {
    if (isLoading) {
      return <Skeleton className="h-12 w-full" />;
    }

    if (alerts.length === 0) return null;

    return (
      <div className="space-y-2">
        {alerts.map((alert) => (
          <AlertBanner key={alert.id} alert={alert} />
        ))}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Bulk Alert Manager</CardTitle>
            <p className="text-xs text-muted-foreground">
              {activeCount} active alert{activeCount === 1 ? "" : "s"} today
            </p>
          </div>
          {canWrite && (
            <Button
              size="sm"
              onClick={() => {
                setEditingAlert(null);
                setFormOpen(true);
              }}
            >
              <Plus className="mr-1 h-4 w-4" />
              New Alert
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No alerts configured.</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Message</TableHead>
                  <TableHead>Bulk</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead>Status</TableHead>
                  {canWrite && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((alert) => {
                  const active = isAlertActive(alert, todayISO);
                  return (
                    <TableRow key={alert.id}>
                      <TableCell className="max-w-lg">
                        <p className="truncate">{alert.message}</p>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{alert.bulkCode ?? "—"}</TableCell>
                      <TableCell>{formatDate(alert.startDate)}</TableCell>
                      <TableCell>{formatDate(alert.endDate)}</TableCell>
                      <TableCell>
                        <Badge variant={active ? "default" : "secondary"}>
                          {active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      {canWrite && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => {
                                setEditingAlert(alert);
                                setFormOpen(true);
                              }}
                              aria-label={`Edit alert ${alert.message}`}
                              title="Edit alert"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => handleDelete(alert.id)}
                              aria-label={`Delete alert ${alert.message}`}
                              title="Delete alert"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <AlertForm
        open={formOpen}
        onOpenChange={setFormOpen}
        batches={batches}
        alert={editingAlert}
        isPending={createAlert.isPending || updateAlert.isPending}
        onSubmit={editingAlert ? handleUpdate : handleCreate}
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete Alert"
        description="Are you sure you want to delete this alert? This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </Card>
  );
}
