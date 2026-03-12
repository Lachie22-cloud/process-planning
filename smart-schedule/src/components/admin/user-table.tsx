import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MoreHorizontal, Pencil, UserX, UserCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "@/hooks/use-current-site";
import { usePermissions } from "@/hooks/use-permissions";
import type { DatabaseRow } from "@/types/database";

interface SiteUser {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  active: boolean;
  createdAt: string;
}

function mapSiteUser(row: DatabaseRow["site_users"]): SiteUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    active: row.active,
    createdAt: row.created_at,
  };
}

function canManageUser(
  targetUser: SiteUser,
  currentUserId: string | undefined,
  currentUserRole: string | undefined,
): boolean {
  if (!currentUserId || !currentUserRole) return false;
  if (targetUser.id === currentUserId) return false;
  if (currentUserRole === "super_admin") return true;
  if (currentUserRole === "site_admin" && targetUser.role !== "super_admin") return true;
  return false;
}

function formatRoleLabel(role: string): string {
  return role
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function UserTable() {
  const { site, user: currentUser } = useCurrentSite();
  const { isSuperAdmin } = usePermissions();
  const queryClient = useQueryClient();

  const [editRoleUser, setEditRoleUser] = useState<SiteUser | null>(null);
  const [editRoleValue, setEditRoleValue] = useState("");
  const [deactivateTarget, setDeactivateTarget] = useState<SiteUser | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<SiteUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SiteUser | null>(null);

  const { data: users = [], isLoading } = useQuery<SiteUser[]>({
    queryKey: ["site_users", site?.id],
    queryFn: async () => {
      if (!site) return [];
      const { data, error } = await supabase
        .from("site_users")
        .select("*")
        .eq("site_id", site.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as DatabaseRow["site_users"][]).map(mapSiteUser);
    },
    enabled: !!site,
  });

  const updateRole = useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: string }) => {
      if (!site) throw new Error("No site selected");
      if (newRole === "super_admin" && currentUser?.role !== "super_admin") {
        throw new Error("Only super admins can grant super admin role");
      }
      const { error } = await supabase
        .from("site_users")
        .update({ role: newRole } as never)
        .eq("id", userId)
        .eq("site_id", site.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site_users"] });
      toast.success(`Role updated to ${formatRoleLabel(editRoleValue)}`);
      setEditRoleUser(null);
    },
    onError: (err: Error) => {
      toast.error(`Failed to update role: ${err.message}`);
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ userId, active }: { userId: string; active: boolean }) => {
      if (!site) throw new Error("No site selected");
      const { error } = await supabase
        .from("site_users")
        .update({ active } as never)
        .eq("id", userId)
        .eq("site_id", site.id);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["site_users"] });
      toast.success(variables.active ? "User reactivated" : "User deactivated");
      setDeactivateTarget(null);
      setReactivateTarget(null);
    },
    onError: (err: Error) => {
      toast.error(`Failed to update user: ${err.message}`);
    },
  });

  const deleteUser = useMutation({
    mutationFn: async ({ userId }: { userId: string }) => {
      if (!site) throw new Error("No site selected");
      const { error } = await supabase
        .from("site_users")
        .delete()
        .eq("id", userId)
        .eq("site_id", site.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site_users"] });
      toast.success("User deleted");
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete user: ${err.message}`);
    },
  });

  function openEditRole(siteUser: SiteUser) {
    setEditRoleUser(siteUser);
    setEditRoleValue(siteUser.role);
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Added</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No users configured for this site.
                </TableCell>
              </TableRow>
            ) : (
              users.map((rowUser) => (
                <TableRow key={rowUser.id}>
                  <TableCell className="font-medium">
                    {rowUser.displayName ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-48 truncate">{rowUser.email}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        rowUser.role === "super_admin"
                          ? "default"
                          : rowUser.role === "site_admin"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {formatRoleLabel(rowUser.role)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={rowUser.active ? "default" : "destructive"}>
                      {rowUser.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                    {format(new Date(rowUser.createdAt), "d MMM yyyy")}
                  </TableCell>
                  <TableCell>
                    {canManageUser(rowUser, currentUser?.id, currentUser?.role) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditRole(rowUser)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Change Role
                          </DropdownMenuItem>
                          {rowUser.active ? (
                            <DropdownMenuItem onClick={() => setDeactivateTarget(rowUser)}>
                              <UserX className="mr-2 h-4 w-4" />
                              Deactivate
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => setReactivateTarget(rowUser)}>
                              <UserCheck className="mr-2 h-4 w-4" />
                              Reactivate
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteTarget(rowUser)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Change Role Dialog */}
      <Dialog open={!!editRoleUser} onOpenChange={(open) => { if (!open) setEditRoleUser(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Change Role</DialogTitle>
            <DialogDescription>
              Update the base role for {editRoleUser?.displayName ?? editRoleUser?.email}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="edit-role">Role</Label>
            <Select value={editRoleValue} onValueChange={setEditRoleValue}>
              <SelectTrigger id="edit-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="site_admin">Site Admin</SelectItem>
                {isSuperAdmin && (
                  <SelectItem value="super_admin">Super Admin</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRoleUser(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editRoleUser) {
                  updateRole.mutate({ userId: editRoleUser.id, newRole: editRoleValue });
                }
              }}
              disabled={updateRole.isPending || editRoleValue === editRoleUser?.role}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deactivate Confirmation */}
      <AlertDialog open={!!deactivateTarget} onOpenChange={(open) => { if (!open) setDeactivateTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate User</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate {deactivateTarget?.displayName ?? deactivateTarget?.email}.
              They will lose access but their data will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deactivateTarget) {
                  toggleActive.mutate({ userId: deactivateTarget.id, active: false });
                }
              }}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reactivate Confirmation */}
      <AlertDialog open={!!reactivateTarget} onOpenChange={(open) => { if (!open) setReactivateTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reactivate User</AlertDialogTitle>
            <AlertDialogDescription>
              This will reactivate {reactivateTarget?.displayName ?? reactivateTarget?.email}.
              They will regain access with their existing role.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (reactivateTarget) {
                  toggleActive.mutate({ userId: reactivateTarget.id, active: true });
                }
              }}
            >
              Reactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove {deleteTarget?.displayName ?? deleteTarget?.email} from
              this site. All tenant role assignments for this user will also be deleted. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) {
                  deleteUser.mutate({ userId: deleteTarget.id });
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
