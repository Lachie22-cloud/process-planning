import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, RotateCcw, Save } from "lucide-react";
import { useTenantRoles, useUpdateTenantRolePermissions, type TenantRole } from "@/hooks/use-rbac-admin";
import { PERMISSIONS, type Permission } from "@/lib/constants/permissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type RoleDiff = {
  roleId: string;
  roleCode: string;
  roleName: string;
  before: string[];
  after: string[];
  added: string[];
  removed: string[];
};

const BASELINE_ROLE_PERMISSIONS: Record<string, Permission[]> = {
  admin: [
    "batches.read",
    "batches.write",
    "batches.schedule",
    "batches.status",
    "resources.read",
    "resources.write",
    "rules.read",
    "rules.write",
    "planning.import",
    "planning.coverage",
    "planning.vet",
    "planning.export",
    "planning.ai",
    "admin.users",
    "admin.settings",
    "alerts.read",
    "alerts.write",
    "alerts.acknowledge",
  ],
  planner: [
    "batches.read",
    "batches.write",
    "batches.schedule",
    "batches.status",
    "resources.read",
    "resources.write",
    "rules.read",
    "planning.import",
    "planning.coverage",
    "planning.vet",
    "planning.export",
    "planning.ai",
    "alerts.read",
    "alerts.acknowledge",
  ],
  operational_lead: [
    "batches.read",
    "resources.read",
    "rules.read",
    "planning.coverage",
    "alerts.read",
  ],
  production: [
    "batches.read",
    "batches.status",
    "resources.read",
    "rules.read",
    "planning.coverage",
    "alerts.read",
  ],
  qc_pc: [
    "batches.read",
    "batches.status",
    "alerts.read",
    "alerts.write",
    "alerts.acknowledge",
  ],
  viewer: [
    "batches.read",
    "resources.read",
    "rules.read",
    "planning.coverage",
    "alerts.read",
  ],
};

function sortUnique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function getBaselinePermissions(roleCode: string): string[] {
  const baseline = BASELINE_ROLE_PERMISSIONS[roleCode];
  return baseline ? [...baseline] : [];
}

function diffArrays(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);

  return {
    added: after.filter((value) => !beforeSet.has(value)),
    removed: before.filter((value) => !afterSet.has(value)),
  };
}

function buildRoleDiff(role: TenantRole, afterPermissions: string[]): RoleDiff {
  const before = sortUnique(role.permissions);
  const after = sortUnique(afterPermissions);
  const { added, removed } = diffArrays(before, after);

  return {
    roleId: role.id,
    roleCode: role.code,
    roleName: role.name,
    before,
    after,
    added,
    removed,
  };
}

function evaluateGuardrails(roles: TenantRole[], drafts: Record<string, string[]>): string[] {
  const errors: string[] = [];

  const merged = roles.map((role) => {
    const draftPermissions = drafts[role.id];
    const permissions = sortUnique(draftPermissions ? draftPermissions : role.permissions);
    return { role, permissions };
  });

  const rolesWithAdminUsers = merged.filter((item) => item.permissions.includes("admin.users"));
  const rolesWithAdminSettings = merged.filter((item) => item.permissions.includes("admin.settings"));

  if (rolesWithAdminUsers.length === 0) {
    errors.push("At least one role must keep `admin.users`.");
  }

  if (rolesWithAdminSettings.length === 0) {
    errors.push("At least one role must keep `admin.settings`.");
  }

  const adminRole = merged.find((item) => item.role.code === "admin" && item.role.is_system);
  if (adminRole) {
    if (!adminRole.permissions.includes("admin.users")) {
      errors.push("System `admin` role cannot remove `admin.users`.");
    }
    if (!adminRole.permissions.includes("admin.settings")) {
      errors.push("System `admin` role cannot remove `admin.settings`.");
    }
  }

  return errors;
}

export function RolePermissionMatrix() {
  const { data: roles = [], isLoading, error } = useTenantRoles(true);
  const updateRolePermissions = useUpdateTenantRolePermissions();

  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [guardrailErrors, setGuardrailErrors] = useState<string[]>([]);
  const [pendingDialog, setPendingDialog] = useState<
    | {
        mode: "save" | "reset";
        title: string;
        description: string;
        diffs: RoleDiff[];
      }
    | null
  >(null);

  const sortedRoles = useMemo(
    () => [...roles].sort((a, b) => a.name.localeCompare(b.name)),
    [roles],
  );

  const permissionCodes = useMemo(() => Object.keys(PERMISSIONS) as Permission[], []);

  const effectiveDrafts = useMemo(() => {
    const merged: Record<string, string[]> = {};
    for (const role of roles) {
      const draftPermissions = drafts[role.id];
      merged[role.id] = sortUnique(draftPermissions ? draftPermissions : role.permissions);
    }
    return merged;
  }, [roles, drafts]);

  const pendingDiffs = useMemo(() => {
    return roles
      .map((role) => buildRoleDiff(role, effectiveDrafts[role.id] ?? role.permissions))
      .filter((diff) => diff.added.length > 0 || diff.removed.length > 0);
  }, [roles, effectiveDrafts]);

  function updateRolePermission(roleId: string, permissionCode: Permission, enabled: boolean) {
    setDrafts((current) => {
      const existing = current[roleId] ?? roles.find((role) => role.id === roleId)?.permissions ?? [];
      const next = new Set(existing);
      if (enabled) {
        next.add(permissionCode);
      } else {
        next.delete(permissionCode);
      }

      return {
        ...current,
        [roleId]: sortUnique([...next]),
      };
    });

    setGuardrailErrors([]);
  }

  function openSaveConfirmation() {
    if (pendingDiffs.length === 0) {
      toast.info("No permission changes to save.");
      return;
    }

    const errors = evaluateGuardrails(roles, effectiveDrafts);
    if (errors.length > 0) {
      setGuardrailErrors(errors);
      return;
    }

    setPendingDialog({
      mode: "save",
      title: "Confirm permission updates",
      description: "Review before/after role permission changes before applying.",
      diffs: pendingDiffs,
    });
  }

  function openResetConfirmation() {
    const baselineRoles = sortedRoles.filter((role) => getBaselinePermissions(role.code).length > 0);
    const missingBaselineRoles = Object.keys(BASELINE_ROLE_PERMISSIONS).filter(
      (code) => !sortedRoles.some((role) => role.code === code),
    );

    if (missingBaselineRoles.length > 0) {
      setGuardrailErrors([
        `Reset blocked: missing baseline roles ${missingBaselineRoles.join(", ")}. Add those roles before resetting.`,
      ]);
      return;
    }

    const diffs = baselineRoles
      .map((role) => {
        const next = getBaselinePermissions(role.code);
        return buildRoleDiff(role, next);
      })
      .filter((diff) => diff.added.length > 0 || diff.removed.length > 0);

    if (diffs.length === 0) {
      toast.info("Roles already match Rocklea baseline.");
      return;
    }

    const draftForGuardrail: Record<string, string[]> = {};
    for (const role of roles) {
      const baselinePermissions = getBaselinePermissions(role.code);
      draftForGuardrail[role.id] =
        baselinePermissions.length > 0
          ? [...baselinePermissions]
          : effectiveDrafts[role.id] ?? role.permissions;
    }

    const errors = evaluateGuardrails(roles, draftForGuardrail);
    if (errors.length > 0) {
      setGuardrailErrors(errors);
      return;
    }

    setPendingDialog({
      mode: "reset",
      title: "Reset role templates to Rocklea baseline",
      description: "This will overwrite current template permissions for baseline roles.",
      diffs,
    });
  }

  async function applyConfirmedChanges() {
    if (!pendingDialog) {
      return;
    }

    try {
      for (const diff of pendingDialog.diffs) {
        await updateRolePermissions.mutateAsync({
          tenantRoleId: diff.roleId,
          permissionCodes: diff.after,
        });
      }

      setDrafts({});
      setGuardrailErrors([]);
      setPendingDialog(null);
      toast.success(
        pendingDialog.mode === "reset"
          ? "Role templates reset to baseline."
          : "Role permission changes applied.",
      );
    } catch (mutationError) {
      const message = mutationError instanceof Error ? mutationError.message : "Unknown error";
      toast.error(`Failed to update permissions: ${message}`);
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Role Template Editor</CardTitle>
          <CardDescription>Permission matrix for tenant role templates.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 4 }).map((_, idx) => (
            <Skeleton key={idx} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Role Template Editor</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Failed to load roles</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Role Template Editor</CardTitle>
              <CardDescription>
                Permission matrix for tenant role templates. Changes are saved via RBAC API.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={openResetConfirmation}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Reset to Baseline
              </Button>
              <Button onClick={openSaveConfirmation} disabled={pendingDiffs.length === 0 || updateRolePermissions.isPending}>
                <Save className="mr-2 h-4 w-4" />
                Save Changes
              </Button>
            </div>
          </div>
          {pendingDiffs.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {pendingDiffs.length} role template{pendingDiffs.length > 1 ? "s" : ""} modified.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">No unsaved permission changes.</p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {guardrailErrors.length > 0 && (
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
          )}

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-48">Permission</TableHead>
                  {sortedRoles.map((role) => (
                    <TableHead key={role.id} className="min-w-28">
                      <div className="space-y-1">
                        <div className="text-xs font-semibold">{role.name}</div>
                        {role.is_system ? <Badge variant="outline">System</Badge> : null}
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {permissionCodes.map((permissionCode) => (
                  <TableRow key={permissionCode}>
                    <TableCell>
                      <p className="truncate font-mono text-xs">{permissionCode}</p>
                      <p className="hidden text-xs text-muted-foreground xl:block">{PERMISSIONS[permissionCode]}</p>
                    </TableCell>
                    {sortedRoles.map((role) => {
                      const enabled = (effectiveDrafts[role.id] ?? []).includes(permissionCode);
                      return (
                        <TableCell key={`${role.id}:${permissionCode}`}>
                          <div className="flex justify-center">
                            <Switch
                              checked={enabled}
                              onCheckedChange={(checked) => updateRolePermission(role.id, permissionCode, checked)}
                              aria-label={`Toggle ${permissionCode} for role ${role.code}`}
                            />
                          </div>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(pendingDialog)} onOpenChange={(open) => (!open ? setPendingDialog(null) : undefined)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{pendingDialog?.title}</DialogTitle>
            <DialogDescription>{pendingDialog?.description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {pendingDialog?.diffs.map((diff) => (
              <div key={diff.roleId} className="rounded-lg border p-3">
                <p className="text-sm font-medium">
                  {diff.roleName} <span className="font-mono text-xs text-muted-foreground">({diff.roleCode})</span>
                </p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium text-emerald-700">Added</p>
                    {diff.added.length === 0 ? (
                      <p className="text-xs text-muted-foreground">None</p>
                    ) : (
                      <ul className="space-y-1 text-xs">
                        {diff.added.map((value) => (
                          <li key={`${diff.roleId}:add:${value}`} className="font-mono">
                            + {value}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-destructive">Removed</p>
                    {diff.removed.length === 0 ? (
                      <p className="text-xs text-muted-foreground">None</p>
                    ) : (
                      <ul className="space-y-1 text-xs">
                        {diff.removed.map((value) => (
                          <li key={`${diff.roleId}:remove:${value}`} className="font-mono">
                            - {value}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDialog(null)} disabled={updateRolePermissions.isPending}>
              Cancel
            </Button>
            <Button onClick={applyConfirmedChanges} disabled={updateRolePermissions.isPending}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
