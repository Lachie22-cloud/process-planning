import { ShieldAlert } from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RolePermissionMatrix } from "@/components/admin/role-permission-matrix";
import { UserRoleAssignment } from "@/components/admin/user-role-assignment";
import { RbacAuditLog } from "@/components/admin/rbac-audit-log";

export function AccessControl() {
  const { isAdmin } = usePermissions();

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access Control</CardTitle>
          <CardDescription>Manage tenant RBAC roles, assignments, and audit history.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center text-muted-foreground">
            <ShieldAlert className="h-10 w-10" />
            <p className="font-medium">Access Denied</p>
            <p className="text-sm">Only site admins can manage access control settings.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Access Control</CardTitle>
        <CardDescription>
          Manage role templates, user role assignments, and RBAC audit history for this site.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="roles" className="space-y-4">
          <TabsList className="grid w-full grid-cols-1 sm:grid-cols-3">
            <TabsTrigger value="roles">Role Templates</TabsTrigger>
            <TabsTrigger value="assignments">User Assignments</TabsTrigger>
            <TabsTrigger value="audit">RBAC Audit</TabsTrigger>
          </TabsList>

          <TabsContent value="roles">
            <RolePermissionMatrix />
          </TabsContent>
          <TabsContent value="assignments">
            <UserRoleAssignment />
          </TabsContent>
          <TabsContent value="audit">
            <RbacAuditLog />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
