import { PageHeader } from "@/components/layout/page-header";
import { PermissionGate } from "@/components/shared/permission-gate";
import { AlertManager } from "@/components/alerts/alert-manager";

export function AlertsPage() {
  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Alerts"
        description="Manage bulk alerts and alert date windows"
      />

      <PermissionGate
        permission="alerts.read"
        fallback={
          <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            You do not have permission to view alerts.
          </div>
        }
      >
        <AlertManager mode="manager" />
      </PermissionGate>
    </div>
  );
}
