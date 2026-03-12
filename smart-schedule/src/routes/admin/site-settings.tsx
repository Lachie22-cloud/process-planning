import { PageHeader } from "@/components/layout/page-header";
import { SiteForm } from "@/components/admin/site-form";
import { AccessControl } from "@/components/admin/access-control";

export function AdminSiteSettingsPage() {
  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Site Settings"
        description="Configure site preferences and tenant access control"
      />

      <SiteForm />
      <AccessControl />
    </div>
  );
}
