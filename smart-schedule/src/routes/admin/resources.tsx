import { PageHeader } from "@/components/layout/page-header";
import { ResourceConfig } from "@/components/admin/resource-config";
import { ShieldAlert } from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";

export function AdminResourcesPage() {
  const { isAdmin } = usePermissions();

  if (!isAdmin) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader
          title="Resource Configuration"
          description="Configure mixers, dispersers, and pot groups for this site"
        />
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          <ShieldAlert className="h-10 w-10" />
          <p className="font-medium">Access Denied</p>
          <p className="text-sm">Only site admins can manage resources.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Resource Configuration"
        description="Configure mixers, dispersers, and pot groups for this site"
      />

      <ResourceConfig />
    </div>
  );
}
