import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { AlertTriangle, Pencil } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "@/hooks/use-current-site";
import { useAssignUserRoles, useTenantRoles, type TenantRole } from "@/hooks/use-rbac-admin";
import type { DatabaseRow } from "@/types/database";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type SiteUserRow = DatabaseRow["site_users"];

type UserAssignment = {
  roleCodes: string[];
  expiresAt: string | null;
};

type PendingAssignment = {
  userId: string;
  email: string;
  displayName: string | null;
  previousRoleCodes: string[];
  nextRoleCodes: string[];
  previousExpiresAt: string | null;
  nextExpiresAt: string | null;
  addedRoles: string[];
  removedRoles: string[];
};

type TenantUserRoleJoinRow = {
  user_id: string;
  expires_at: string | null;
  tenant_roles: { code?: string } | Array<{ code?: string }> | null;
};

function toSortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function toDateTimeLocal(value: string | null): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const pad = (v: number) => String(v).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDateTimeLocal(value: string): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Never";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return format(parsed, "d MMM yyyy, HH:mm");
}

function buildRolePermissionMap(roles: TenantRole[]): Map<string, Set<string>> {
  const mapping = new Map<string, Set<string>>();
  for (const role of roles) {
    mapping.set(role.code, new Set(role.permissions));
  }
  return mapping;
}

function resolveJoinedRoleCode(value: TenantUserRoleJoinRow["tenant_roles"]): string | null {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first?.code === "string" ? first.code : null;
  }

  return typeof value.code === "string" ? value.code : null;
}

function hasPermission(roleCodes: string[], rolePermissionMap: Map<string, Set<string>>, permission: string): boolean {
  for (const roleCode of roleCodes) {
    const permissions = rolePermissionMap.get(roleCode);
    if (permissions?.has(permission)) {
      return true;
    }
  }
  return false;
}

export function UserRoleAssignment() {
  const { site, user: currentUser } = useCurrentSite();
  const { data: roles = [], isLoading: rolesLoading } = useTenantRoles(true);
  const assignRoles = useAssignUserRoles();

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [draftRoleCodes, setDraftRoleCodes] = useState<string[]>([]);
  const [draftExpiresAt, setDraftExpiresAt] = useState<string>("");
  const [guardrailErrors, setGuardrailErrors] = useState<string[]>([]);
  const [pendingDialog, setPendingDialog] = useState<PendingAssignment | null>(null);

  const { data: siteUsers = [], isLoading: usersLoading, error: usersError } = useQuery<SiteUserRow[]>({
    queryKey: ["site_users", site?.id],
    queryFn: async () => {
      if (!site?.id) {
        return [];
      }

      const { data, error } = await supabase
        .from("site_users")
        .select("*")
        .eq("site_id", site.id)
        .eq("active", true)
        .order("email", { ascending: true });

      if (error) {
        throw error;
      }

      return data as SiteUserRow[];
    },
    enabled: Boolean(site?.id),
  });

  const { data: assignments = {}, isLoading: assignmentsLoading, error: assignmentsError } = useQuery<
    Record<string, UserAssignment>
  >({
    queryKey: ["tenant_user_roles", site?.id],
    queryFn: async () => {
      if (!site?.id) {
        return {};
      }

      const { data, error } = await supabase
        .from("tenant_user_roles")
        .select("user_id, expires_at, tenant_roles!inner(code)")
        .eq("site_id", site.id)
        .eq("active", true);

      if (error) {
        throw error;
      }

      const grouped: Record<string, UserAssignment> = {};
      const rows = (data ?? []) as unknown as TenantUserRoleJoinRow[];

      for (const row of rows) {
        const entry = grouped[row.user_id] ?? {
            roleCodes: [],
            expiresAt: null,
          };

        const roleCode = resolveJoinedRoleCode(row.tenant_roles);
        if (roleCode) {
          entry.roleCodes.push(roleCode);
        }

        if (!entry.expiresAt && row.expires_at) {
          entry.expiresAt = row.expires_at;
        }

        grouped[row.user_id] = entry;
      }

      for (const userId of Object.keys(grouped)) {
        const entry = grouped[userId];
        if (!entry) {
          continue;
        }

        grouped[userId] = {
          ...entry,
          roleCodes: toSortedUnique(entry.roleCodes),
        };
      }

      return grouped;
    },
    enabled: Boolean(site?.id),
  });

  const rolesByCode = useMemo(() => {
    const map = new Map<string, TenantRole>();
    for (const role of roles) {
      map.set(role.code, role);
    }
    return map;
  }, [roles]);

  const rolePermissionMap = useMemo(() => buildRolePermissionMap(roles), [roles]);

  const editingUser = useMemo(
    () => siteUsers.find((row) => row.id === editingUserId) ?? null,
    [siteUsers, editingUserId],
  );

  function openEditor(targetUserId: string) {
    const existing = assignments[targetUserId] ?? { roleCodes: [], expiresAt: null };
    setEditingUserId(targetUserId);
    setDraftRoleCodes(existing.roleCodes);
    setDraftExpiresAt(toDateTimeLocal(existing.expiresAt));
    setGuardrailErrors([]);
  }

  function toggleRole(roleCode: string, enabled: boolean) {
    setDraftRoleCodes((current) => {
      const next = new Set(current);
      if (enabled) {
        next.add(roleCode);
      } else {
        next.delete(roleCode);
      }
      return toSortedUnique([...next]);
    });
  }

  function evaluateGuardrails(targetUserId: string, nextRoleCodes: string[], nextExpiresAtIso: string | null): string[] {
    const errors: string[] = [];

    if (nextRoleCodes.length === 0) {
      errors.push("A user must have at least one tenant role.");
    }

    if (nextExpiresAtIso) {
      const expiry = new Date(nextExpiresAtIso);
      if (expiry.getTime() <= Date.now()) {
        errors.push("Expiry must be in the future.");
      }
    }

    if (currentUser?.id === targetUserId) {
      if (!hasPermission(nextRoleCodes, rolePermissionMap, "admin.users")) {
        errors.push("You cannot remove your own `admin.users` permission.");
      }
      if (!hasPermission(nextRoleCodes, rolePermissionMap, "admin.settings")) {
        errors.push("You cannot remove your own `admin.settings` permission.");
      }
    }

    const simulatedAssignments: Record<string, string[]> = {};
    for (const siteUser of siteUsers) {
      simulatedAssignments[siteUser.id] = assignments[siteUser.id]?.roleCodes ?? [];
    }
    simulatedAssignments[targetUserId] = nextRoleCodes;

    const usersWithAdminUsers = siteUsers.filter((siteUser) =>
      hasPermission(simulatedAssignments[siteUser.id] ?? [], rolePermissionMap, "admin.users"),
    );

    const usersWithAdminSettings = siteUsers.filter((siteUser) =>
      hasPermission(simulatedAssignments[siteUser.id] ?? [], rolePermissionMap, "admin.settings"),
    );

    if (usersWithAdminUsers.length === 0) {
      errors.push("At least one user must retain `admin.users`.");
    }

    if (usersWithAdminSettings.length === 0) {
      errors.push("At least one user must retain `admin.settings`.");
    }

    return errors;
  }

  function requestAssignmentConfirmation() {
    if (!editingUser) {
      return;
    }

    const current = assignments[editingUser.id] ?? { roleCodes: [], expiresAt: null };
    const nextRoleCodes = toSortedUnique(draftRoleCodes);
    const nextExpiresAt = fromDateTimeLocal(draftExpiresAt);
    const addedRoles = nextRoleCodes.filter((code) => !current.roleCodes.includes(code));
    const removedRoles = current.roleCodes.filter((code) => !nextRoleCodes.includes(code));

    if (addedRoles.length === 0 && removedRoles.length === 0 && nextExpiresAt === current.expiresAt) {
      toast.info("No role assignment changes to save.");
      return;
    }

    const errors = evaluateGuardrails(editingUser.id, nextRoleCodes, nextExpiresAt);
    if (errors.length > 0) {
      setGuardrailErrors(errors);
      return;
    }

    setPendingDialog({
      userId: editingUser.id,
      email: editingUser.email,
      displayName: editingUser.display_name,
      previousRoleCodes: current.roleCodes,
      nextRoleCodes,
      previousExpiresAt: current.expiresAt,
      nextExpiresAt,
      addedRoles,
      removedRoles,
    });
  }

  async function applyAssignment() {
    if (!pendingDialog) {
      return;
    }

    try {
      await assignRoles.mutateAsync({
        userId: pendingDialog.userId,
        roleCodes: pendingDialog.nextRoleCodes,
        expiresAt: pendingDialog.nextExpiresAt,
      });

      toast.success("User role assignment updated.");
      setPendingDialog(null);
      setEditingUserId(null);
      setDraftRoleCodes([]);
      setDraftExpiresAt("");
      setGuardrailErrors([]);
    } catch (mutationError) {
      const message = mutationError instanceof Error ? mutationError.message : "Unknown error";
      toast.error(`Failed to update user roles: ${message}`);
    }
  }

  const loading = rolesLoading || usersLoading || assignmentsLoading;

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>User Role Assignments</CardTitle>
          <CardDescription>Assign tenant role templates to users for this site.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 4 }).map((_, idx) => (
            <Skeleton key={idx} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const loadError = usersError ?? assignmentsError;
  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>User Role Assignments</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Failed to load assignment data</AlertTitle>
            <AlertDescription>{loadError.message}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>User Role Assignments</CardTitle>
          <CardDescription>Assign role templates, then confirm before applying changes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {guardrailErrors.length > 0 ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Guardrail blocked this change</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-4">
                  {guardrailErrors.map((msg) => (
                    <li key={msg}>{msg}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-24">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {siteUsers.map((siteUser) => {
                  const userAssignment = assignments[siteUser.id] ?? { roleCodes: [], expiresAt: null };

                  return (
                    <TableRow key={siteUser.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium">{siteUser.display_name ?? siteUser.email}</p>
                          <p className="text-xs text-muted-foreground">{siteUser.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {userAssignment.roleCodes.length === 0 ? (
                            <Badge variant="outline">No tenant roles</Badge>
                          ) : (
                            userAssignment.roleCodes.map((roleCode) => (
                              <Badge key={`${siteUser.id}:${roleCode}`} variant="secondary">
                                {rolesByCode.get(roleCode)?.name ?? roleCode}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(userAssignment.expiresAt)}
                      </TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" onClick={() => openEditor(siteUser.id)}>
                          <Pencil className="mr-2 h-3.5 w-3.5" />
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(editingUser)} onOpenChange={(open) => (!open ? setEditingUserId(null) : undefined)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit User Role Assignment</DialogTitle>
            <DialogDescription>
              {editingUser
                ? `Adjust tenant role templates for ${editingUser.display_name ?? editingUser.email}.`
                : "Adjust tenant role templates."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {roles
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((role) => {
                  const checked = draftRoleCodes.includes(role.code);
                  return (
                    <label
                      key={role.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div>
                        <p className="text-sm font-medium">{role.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{role.code}</p>
                      </div>
                      <Switch
                        checked={checked}
                        onCheckedChange={(enabled) => toggleRole(role.code, enabled)}
                        aria-label={`Toggle role ${role.code}`}
                      />
                    </label>
                  );
                })}
            </div>

            <div className="space-y-2">
              <Label>Assignment expiry (optional)</Label>
              <DateTimePicker
                value={draftExpiresAt}
                onChange={setDraftExpiresAt}
                placeholder="No expiry"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingUserId(null)} disabled={assignRoles.isPending}>
              Cancel
            </Button>
            <Button onClick={requestAssignmentConfirmation} disabled={assignRoles.isPending}>
              Review Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(pendingDialog)} onOpenChange={(open) => (!open ? setPendingDialog(null) : undefined)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Confirm user role assignment</DialogTitle>
            <DialogDescription>
              Review before/after changes for {pendingDialog?.displayName ?? pendingDialog?.email}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-emerald-700">Added roles</p>
                {pendingDialog?.addedRoles.length ? (
                  <ul className="space-y-1 text-xs">
                    {pendingDialog.addedRoles.map((roleCode) => (
                      <li key={`added:${roleCode}`} className="font-mono">
                        + {roleCode}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">None</p>
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-destructive">Removed roles</p>
                {pendingDialog?.removedRoles.length ? (
                  <ul className="space-y-1 text-xs">
                    {pendingDialog.removedRoles.map((roleCode) => (
                      <li key={`removed:${roleCode}`} className="font-mono">
                        - {roleCode}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">None</p>
                )}
              </div>
            </div>

            <div className="rounded-lg border p-3 text-xs">
              <p>
                Expiry: <span className="font-medium">{formatDate(pendingDialog?.previousExpiresAt ?? null)}</span>
                {" -> "}
                <span className="font-medium">{formatDate(pendingDialog?.nextExpiresAt ?? null)}</span>
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDialog(null)} disabled={assignRoles.isPending}>
              Cancel
            </Button>
            <Button onClick={applyAssignment} disabled={assignRoles.isPending}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
