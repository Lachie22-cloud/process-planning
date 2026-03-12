import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrentSite } from "./use-current-site";
import { PERMISSIONS, type Permission } from "@/lib/constants/permissions";
import { getEffectivePermissionsForUser } from "./use-rbac-admin";

/**
 * Iteration 1 RBAC: permission check based on the 3 base roles.
 * Granular permissions (Planner/QC/Production/P&C) deferred to iteration 2.
 */

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  super_admin: [
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
    "admin.sites",
    "alerts.read",
    "alerts.acknowledge",
    "alerts.write",
  ],
  site_admin: [
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
    "alerts.acknowledge",
    "alerts.write",
  ],
  member: [
    "batches.read",
    "batches.status",
    "resources.read",
    "rules.read",
    "planning.coverage",
    "alerts.read",
    "alerts.acknowledge",
  ],
};

function isPermission(value: string): value is Permission {
  return value in PERMISSIONS;
}

export function usePermissions() {
  const { user, site } = useCurrentSite();

  const {
    data: effectivePermissions,
    isError: effectivePermissionsError,
  } = useQuery({
    queryKey: ["effective_permissions", site?.id, user?.id],
    queryFn: () => {
      if (!site?.id || !user?.id) {
        throw new Error("Site and user are required");
      }
      return getEffectivePermissionsForUser({
        siteId: site.id,
        userId: user.id,
      });
    },
    enabled: Boolean(site?.id && user?.id),
    staleTime: 30_000,
  });

  const permissions = useMemo(() => {
    if (!user) return [] as Permission[];

    if (effectivePermissions) {
      return effectivePermissions.permissions.filter(isPermission);
    }

    if (effectivePermissionsError) {
      return ROLE_PERMISSIONS[user.role] ?? ([] as Permission[]);
    }

    return ROLE_PERMISSIONS[user.role] ?? ([] as Permission[]);
  }, [user, effectivePermissions, effectivePermissionsError]);

  const hasPermission = (permission: Permission) => {
    return permissions.includes(permission);
  };

  const isAdmin = user?.role === "super_admin" || user?.role === "site_admin";
  const isSuperAdmin = user?.role === "super_admin";

  return { hasPermission, permissions, isAdmin, isSuperAdmin };
}
