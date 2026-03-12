import { useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/layout/page-header";
import { UserTable } from "@/components/admin/user-table";
import { UserInviteForm } from "@/components/admin/user-invite-form";
import { Button } from "@/components/ui/button";
import { UserPlus, Settings } from "lucide-react";

export function AdminUsersPage() {
  const [inviteOpen, setInviteOpen] = useState(false);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="User Management"
        description="Add, remove, and manage user access for this site"
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Add User
          </Button>
        }
      />

      <UserTable />

      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Settings className="h-4 w-4" />
        To configure role-based access control, go to{" "}
        <Link
          to="/admin/settings"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Site Settings &rsaquo; Access Control
        </Link>
      </p>

      <UserInviteForm open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}
