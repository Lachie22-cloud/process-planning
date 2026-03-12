import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "@/hooks/use-current-site";

type JsonRecord = Record<string, unknown>;

type RpcSuccess<T> = {
  success: true;
} & T;

type RpcFailure = {
  success: false;
  error: string;
} & JsonRecord;

type RpcResult<T> = RpcSuccess<T> | RpcFailure;

export type TenantRole = {
  id: string;
  site_id: string;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
  permissions: string[];
};

export type EffectiveUserPermissions = {
  user_id: string;
  site_id: string;
  role_codes: string[];
  permissions: string[];
  fetched_at: string;
};

type ListTenantRolesPayload = {
  roles: TenantRole[];
};

type UpdateTenantRolePermissionsPayload = {
  tenant_role_id: string;
  permission_codes: string[];
};

type AssignUserRolesPayload = {
  user_id: string;
  role_codes: string[];
  expires_at: string | null;
};

function isObject(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function parseRpcResult<T>(value: unknown): RpcResult<T> {
  if (!isObject(value) || typeof value.success !== "boolean") {
    throw new Error("Invalid RPC response shape");
  }

  return value as RpcResult<T>;
}

async function callRpc<T>(fn: string, args: JsonRecord): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;

  const parsed = parseRpcResult<T>(data);
  if (!parsed.success) {
    throw new Error(parsed.error || "RPC request failed");
  }

  return parsed;
}

export async function listTenantRoles(siteId: string): Promise<TenantRole[]> {
  const result = await callRpc<ListTenantRolesPayload>("list_tenant_roles", {
    p_site_id: siteId,
  });
  return result.roles;
}

export async function updateTenantRolePermissions(input: {
  siteId: string;
  tenantRoleId: string;
  permissionCodes: string[];
}): Promise<UpdateTenantRolePermissionsPayload> {
  return callRpc<UpdateTenantRolePermissionsPayload>("update_tenant_role_permissions", {
    p_site_id: input.siteId,
    p_tenant_role_id: input.tenantRoleId,
    p_permission_codes: input.permissionCodes,
  });
}

export async function assignUserRoles(input: {
  siteId: string;
  userId: string;
  roleCodes: string[];
  expiresAt?: string | null;
}): Promise<AssignUserRolesPayload> {
  return callRpc<AssignUserRolesPayload>("assign_user_roles", {
    p_site_id: input.siteId,
    p_user_id: input.userId,
    p_role_codes: input.roleCodes,
    p_expires_at: input.expiresAt ?? null,
  });
}

export async function getEffectivePermissionsForUser(input: {
  siteId: string;
  userId: string;
}): Promise<EffectiveUserPermissions> {
  return callRpc<EffectiveUserPermissions>("get_effective_permissions_for_user", {
    p_site_id: input.siteId,
    p_user_id: input.userId,
  });
}

export function useTenantRoles(enabled = true) {
  const { site } = useCurrentSite();

  return useQuery<TenantRole[]>({
    queryKey: ["tenant_roles", site?.id],
    queryFn: () => {
      if (!site?.id) {
        throw new Error("No site selected");
      }
      return listTenantRoles(site.id);
    },
    enabled: enabled && Boolean(site?.id),
  });
}

export function useUpdateTenantRolePermissions() {
  const queryClient = useQueryClient();
  const { site } = useCurrentSite();

  return useMutation({
    mutationFn: async (input: { tenantRoleId: string; permissionCodes: string[] }) => {
      if (!site?.id) {
        throw new Error("No site selected");
      }

      return updateTenantRolePermissions({
        siteId: site.id,
        tenantRoleId: input.tenantRoleId,
        permissionCodes: input.permissionCodes,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant_roles"] });
      queryClient.invalidateQueries({ queryKey: ["effective_permissions"] });
    },
  });
}

export function useAssignUserRoles() {
  const queryClient = useQueryClient();
  const { site } = useCurrentSite();

  return useMutation({
    mutationFn: async (input: { userId: string; roleCodes: string[]; expiresAt?: string | null }) => {
      if (!site?.id) {
        throw new Error("No site selected");
      }

      return assignUserRoles({
        siteId: site.id,
        userId: input.userId,
        roleCodes: input.roleCodes,
        expiresAt: input.expiresAt,
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["tenant_roles"] });
      queryClient.invalidateQueries({ queryKey: ["effective_permissions", site?.id, variables.userId] });
    },
  });
}

export function useEffectivePermissionsForUser(userId?: string) {
  const { site } = useCurrentSite();

  return useQuery<EffectiveUserPermissions>({
    queryKey: ["effective_permissions", site?.id, userId],
    queryFn: () => {
      if (!site?.id || !userId) {
        throw new Error("Site and user are required");
      }

      return getEffectivePermissionsForUser({
        siteId: site.id,
        userId,
      });
    },
    enabled: Boolean(site?.id && userId),
  });
}
