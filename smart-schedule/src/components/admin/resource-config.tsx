import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Pencil, Plus, Power } from "lucide-react";
import { toast } from "sonner";
import {
  useResources,
  useCreateResource,
  useUpdateResource,
  useDeactivateResource,
} from "@/hooks/use-resources";
import { usePermissions } from "@/hooks/use-permissions";
import { ResourceForm } from "./resource-form";
import type { Resource } from "@/types/resource";
import type { ResourceFormInput } from "@/lib/validators/resource";

export function ResourceConfig() {
  const { data: resources = [], isLoading } = useResources(true);
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission("resources.write");

  const createResource = useCreateResource();
  const updateResource = useUpdateResource();
  const deactivateResource = useDeactivateResource();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Resource | null>(null);

  function handleCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function handleEdit(resource: Resource) {
    setEditing(resource);
    setFormOpen(true);
  }

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingResource, setPendingResource] = useState<Resource | null>(null);

  function handleDeactivate(resource: Resource) {
    setPendingResource(resource);
    setConfirmOpen(true);
  }

  function confirmDeactivate() {
    if (!pendingResource) return;
    deactivateResource.mutate(pendingResource.id, {
      onSuccess: () => toast.success(`Resource ${pendingResource.resourceCode} deactivated`),
      onError: (err) => toast.error(`Failed to deactivate: ${err.message}`),
    });
  }

  function handleSubmit(data: ResourceFormInput & { id?: string }) {
    if (data.id) {
      const { id, ...input } = data;
      updateResource.mutate(
        { id, ...input },
        {
          onSuccess: () => {
            toast.success("Resource updated");
            setFormOpen(false);
          },
          onError: (err) => toast.error(`Failed to update: ${err.message}`),
        },
      );
    } else {
      createResource.mutate(data, {
        onSuccess: () => {
          toast.success("Resource created");
          setFormOpen(false);
        },
        onError: (err) => toast.error(`Failed to create: ${err.message}`),
      });
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <>
      {canWrite && (
        <div className="flex justify-end">
          <Button onClick={handleCreate} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Add Resource
          </Button>
        </div>
      )}

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="hidden lg:table-cell">Trunk Line</TableHead>
              <TableHead className="hidden lg:table-cell">Group</TableHead>
              <TableHead className="text-right">Min Cap</TableHead>
              <TableHead className="text-right">Max Cap</TableHead>
              <TableHead className="text-right">Max/Day</TableHead>
              <TableHead>Status</TableHead>
              {canWrite && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {resources.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={canWrite ? 10 : 9}
                  className="text-center text-muted-foreground"
                >
                  No resources configured for this site.
                </TableCell>
              </TableRow>
            ) : (
              resources.map((r) => (
                <TableRow key={r.id} className={!r.active ? "opacity-50" : undefined}>
                  <TableCell className="font-mono text-xs font-medium">
                    {r.resourceCode}
                  </TableCell>
                  <TableCell className="font-medium">
                    {r.displayName ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {r.resourceType}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">{r.trunkLine ?? "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell">{r.groupName ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {r.minCapacity != null ? `${r.minCapacity.toLocaleString()}L` : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {r.maxCapacity != null ? `${r.maxCapacity.toLocaleString()}L` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.maxBatchesPerDay}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.active ? "default" : "secondary"}>
                      {r.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  {canWrite && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleEdit(r)}
                          aria-label={`Edit resource ${r.resourceCode}`}
                          title="Edit resource"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {r.active && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => handleDeactivate(r)}
                            aria-label={`Deactivate resource ${r.resourceCode}`}
                            title="Deactivate resource"
                          >
                            <Power className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ResourceForm
        open={formOpen}
        onOpenChange={setFormOpen}
        resource={editing}
        isPending={createResource.isPending || updateResource.isPending}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Deactivate Resource"
        description={
          pendingResource
            ? `Deactivate resource "${pendingResource.resourceCode}"? It will no longer appear in scheduling.`
            : ""
        }
        confirmLabel="Deactivate"
        variant="destructive"
        onConfirm={confirmDeactivate}
      />
    </>
  );
}
