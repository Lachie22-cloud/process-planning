import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePermissions } from "@/hooks/use-permissions";
import {
  useAiScanTypes,
  useCreateScanType,
  useUpdateScanType,
  useDeleteScanType,
  type AiScanType,
  type AiScanTypeInput,
} from "@/hooks/use-ai-scan-types";
import { Plus, Pencil, Trash2, ScanSearch, RefreshCw } from "lucide-react";
import { Navigate } from "react-router-dom";

interface FormState {
  key: string;
  label: string;
  description: string;
  aiObjective: string;
  enabled: boolean;
  sortOrder: number;
}

const DEFAULT_FORM: FormState = {
  key: "",
  label: "",
  description: "",
  aiObjective: "",
  enabled: true,
  sortOrder: 0,
};

export function AdminAiScanTypesPage() {
  const { hasPermission } = usePermissions();
  const { data: scanTypes, isLoading } = useAiScanTypes();
  const createType = useCreateScanType();
  const updateType = useUpdateScanType();
  const deleteType = useDeleteScanType();

  const [formOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<AiScanType | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [deleteTarget, setDeleteTarget] = useState<AiScanType | null>(null);

  if (!hasPermission("admin.settings")) {
    return <Navigate to="/admin" replace />;
  }

  const openCreate = () => {
    setEditingItem(null);
    const maxSort = (scanTypes ?? []).reduce(
      (max, t) => Math.max(max, t.sortOrder),
      0,
    );
    setForm({ ...DEFAULT_FORM, sortOrder: maxSort + 1 });
    setFormOpen(true);
  };

  const openEdit = (item: AiScanType) => {
    setEditingItem(item);
    setForm({
      key: item.key,
      label: item.label,
      description: item.description ?? "",
      aiObjective: item.aiObjective ?? "",
      enabled: item.enabled,
      sortOrder: item.sortOrder,
    });
    setFormOpen(true);
  };

  const handleSubmit = () => {
    if (!form.key.trim() || !form.label.trim()) return;

    const payload: AiScanTypeInput = {
      key: form.key,
      label: form.label,
      description: form.description || null,
      aiObjective: form.aiObjective || null,
      enabled: form.enabled,
      sortOrder: form.sortOrder,
    };

    if (editingItem) {
      updateType.mutate(
        { id: editingItem.id, ...payload },
        { onSuccess: () => setFormOpen(false) },
      );
    } else {
      createType.mutate(payload, {
        onSuccess: () => setFormOpen(false),
      });
    }
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteType.mutate(deleteTarget, {
      onSuccess: () => setDeleteTarget(null),
    });
  };

  const isMutating = createType.isPending || updateType.isPending;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="AI Scan Types"
        description="Configure the types of AI analysis scans available to users"
        actions={
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New Scan Type
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : (scanTypes ?? []).length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <ScanSearch className="h-12 w-12 text-muted-foreground/50" />
            <p className="mt-4 text-sm text-muted-foreground">
              No scan types configured. Default types will be seeded automatically.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Scan Types</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead className="hidden md:table-cell">
                    Description
                  </TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="w-[100px] text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(scanTypes ?? []).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{item.label}</span>
                        {item.isDefault && (
                          <Badge variant="secondary" className="text-xs">
                            Default
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs">{item.key}</code>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="text-sm text-muted-foreground line-clamp-1">
                        {item.description}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={item.enabled}
                        onCheckedChange={(checked) =>
                          updateType.mutate({
                            id: item.id,
                            enabled: checked,
                          })
                        }
                        disabled={updateType.isPending}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(item)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {!item.isDefault && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteTarget(item)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingItem ? "Edit Scan Type" : "New Scan Type"}
            </DialogTitle>
            <DialogDescription>
              {editingItem
                ? "Update the scan type configuration."
                : "Create a new AI analysis scan type."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Key</Label>
                <Input
                  value={form.key}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, key: e.target.value }))
                  }
                  placeholder="custom_scan"
                  disabled={!!editingItem?.isDefault}
                />
                {editingItem?.isDefault && (
                  <p className="text-xs text-muted-foreground">
                    Default scan type keys cannot be changed
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Label</Label>
                <Input
                  value={form.label}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, label: e.target.value }))
                  }
                  placeholder="Custom Scan"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="Brief description shown in the scan dropdown"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label>AI Objective</Label>
              <Textarea
                value={form.aiObjective}
                onChange={(e) =>
                  setForm((f) => ({ ...f, aiObjective: e.target.value }))
                }
                placeholder="The instruction sent to the AI when running this scan type"
                rows={4}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Sort Order</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.sortOrder}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      sortOrder: parseInt(e.target.value, 10) || 0,
                    }))
                  }
                />
              </div>
              <div className="flex items-center gap-3 pt-6">
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(checked) =>
                    setForm((f) => ({ ...f, enabled: checked }))
                  }
                />
                <Label>Enabled</Label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!form.key.trim() || !form.label.trim() || isMutating}
            >
              {isMutating && (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              )}
              {editingItem ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete Scan Type"
        description={`Are you sure you want to delete "${deleteTarget?.label}"? Existing scans of this type will not be affected.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  );
}
