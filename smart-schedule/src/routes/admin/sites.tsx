import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Pencil, Plus, Power, Trash2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useCurrentSite } from "@/hooks/use-current-site";
import { usePermissions } from "@/hooks/use-permissions";
import { useSites, useCreateSite, useUpdateSite, useDeactivateSite, useDeleteSite } from "@/hooks/use-sites";
import { SiteAdminForm } from "@/components/admin/site-admin-form";
import type { Site } from "@/types/site";
import type { SiteFormInput } from "@/lib/validators/site";

export function AdminSitesPage() {
  const { switchSite, site: currentSite } = useCurrentSite();
  const { isSuperAdmin } = usePermissions();

  const { data: allSites = [], isLoading } = useSites();
  const createSite = useCreateSite();
  const updateSite = useUpdateSite();
  const deactivateSite = useDeactivateSite();
  const deleteSite = useDeleteSite();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Site | null>(null);

  // Confirmation dialog state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);

  // Non-super-admin users must not access site management
  if (!isSuperAdmin) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title="All Sites" description="Super admin: manage all factory sites" />
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          <ShieldAlert className="h-10 w-10" />
          <p className="font-medium">Access Denied</p>
          <p className="text-sm">Only super admins can manage sites.</p>
        </div>
      </div>
    );
  }

  function handleCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function handleEdit(site: Site) {
    setEditing(site);
    setFormOpen(true);
  }

  function handleDeactivate(site: Site) {
    setConfirmAction({
      title: "Deactivate Site",
      description: `Deactivate site "${site.name}" (${site.code})? Users will lose access.`,
      confirmLabel: "Deactivate",
      onConfirm: () => {
        deactivateSite.mutate(site.id, {
          onSuccess: () => toast.success(`Site ${site.code} deactivated`),
          onError: (err) => toast.error(`Failed to deactivate: ${err.message}`),
        });
      },
    });
    setConfirmOpen(true);
  }

  function handleDelete(site: Site) {
    setConfirmAction({
      title: "Delete Site",
      description: `Permanently delete site "${site.name}" (${site.code})? This cannot be undone. All users, resources, and batches associated with this site will be removed.`,
      confirmLabel: "Delete",
      onConfirm: () => {
        deleteSite.mutate(site.id, {
          onSuccess: () => toast.success(`Site ${site.code} deleted`),
          onError: (err) => toast.error(`Failed to delete: ${err.message}`),
        });
      },
    });
    setConfirmOpen(true);
  }

  function handleSubmit(data: SiteFormInput & { id?: string }) {
    if (data.id) {
      const { id, ...input } = data;
      updateSite.mutate(
        { id, ...input },
        {
          onSuccess: () => {
            toast.success("Site updated");
            setFormOpen(false);
          },
          onError: (err) => toast.error(`Failed to update: ${err.message}`),
        },
      );
    } else {
      createSite.mutate(data, {
        onSuccess: () => {
          toast.success("Site created");
          setFormOpen(false);
        },
        onError: (err) => toast.error(`Failed to create: ${err.message}`),
      });
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="All Sites"
        description="Super admin: manage all factory sites"
        actions={
          <Button onClick={handleCreate} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Create Site
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="h-32 animate-pulse bg-muted/50 p-4" />
            </Card>
          ))}
        </div>
      ) : allSites.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          No sites available.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {allSites.map((s) => (
            <Card key={s.id} className={!s.active ? "opacity-60" : undefined}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">{s.name}</h3>
                    <p className="text-sm text-muted-foreground">{s.code}</p>
                  </div>
                  <div className="flex gap-1">
                    <Badge variant={s.active ? "default" : "secondary"}>
                      {s.active ? "Active" : "Inactive"}
                    </Badge>
                    {currentSite?.id === s.id && (
                      <Badge variant="outline">Current</Badge>
                    )}
                  </div>
                </div>
                <div className="mt-3 text-xs text-muted-foreground space-y-1">
                  <p>Timezone: {s.timezone}</p>
                  <p>Schedule horizon: {s.scheduleHorizon} days</p>
                </div>
                <div className="mt-3 flex gap-2">
                  {currentSite?.id !== s.id && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => switchSite(s.id)}
                    >
                      Switch to site
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleEdit(s)}
                    aria-label={`Edit site ${s.name}`}
                    title="Edit site"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {s.active && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleDeactivate(s)}
                      aria-label={`Deactivate site ${s.name}`}
                      title="Deactivate site"
                    >
                      <Power className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {!s.active && currentSite?.id !== s.id && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(s)}
                      aria-label={`Delete site ${s.name}`}
                      title="Delete site"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <SiteAdminForm
        open={formOpen}
        onOpenChange={setFormOpen}
        site={editing}
        isPending={createSite.isPending || updateSite.isPending}
        onSubmit={handleSubmit}
      />

      {confirmAction && (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={confirmAction.title}
          description={confirmAction.description}
          confirmLabel={confirmAction.confirmLabel}
          variant="destructive"
          onConfirm={confirmAction.onConfirm}
        />
      )}
    </div>
  );
}
