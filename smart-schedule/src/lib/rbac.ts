import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getDefaultRbacCache,
  type RbacCache,
  type RbacCacheEntry,
} from "@/lib/rbac-cache";

const ROLE_PERMISSION_FALLBACK: Record<string, string[]> = {
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
    "schedule.view_past",
    "schedule.view_current",
    "schedule.view_future",
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
    "schedule.view_past",
    "schedule.view_current",
    "schedule.view_future",
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
    "schedule.view_past",
    "schedule.view_current",
    "alerts.read",
    "alerts.acknowledge",
  ],
};

type UnknownRecord = Record<string, unknown>;

export type GuardrailPolicy = {
  id: string;
  permissionCode: string;
  effect: "allow" | "deny";
  priority: number;
  conditions: Record<string, unknown>;
};

export type EffectivePermissions = {
  userId: string;
  siteId: string;
  roleCodes: string[];
  permissions: string[];
  guardrails: GuardrailPolicy[];
  fetchedAt: string;
};

export type GuardrailDecision = {
  allowed: boolean;
  reason: "granted" | "missing_permission" | "policy_allow" | "policy_deny";
  matchedPolicyId?: string;
};

type ResolverDependencies = {
  supabase: SupabaseClient;
  cache?: RbacCache;
};

type ResolveOptions = {
  bypassCache?: boolean;
  now?: Date;
};

export function createRbacService({ supabase, cache = getDefaultRbacCache() }: ResolverDependencies) {
  async function getEffectivePermissions(
    userId: string,
    siteId: string,
    options: ResolveOptions = {},
  ): Promise<EffectivePermissions> {
    const now = options.now ?? new Date();

    if (!options.bypassCache) {
      const cached = await cache.get(userId, siteId);
      if (cached) {
        return cacheEntryToEffectivePermissions(cached);
      }
    }

    const [roleCodes, rolePermissions, guardrails] = await Promise.all([
      fetchRoleCodes(supabase, userId, siteId, now),
      fetchRolePermissions(supabase, userId, siteId, now),
      fetchGuardrails(supabase, siteId),
    ]);

    const permissionSet = new Set<string>(rolePermissions);
    applyGuardrailMaterialization(permissionSet, guardrails, {
      userId,
      siteId,
      roleCodes,
    });

    const entry: RbacCacheEntry = {
      userId,
      siteId,
      roleCodes: [...roleCodes].sort(),
      permissions: [...permissionSet].sort(),
      guardrails,
      fetchedAt: now.toISOString(),
    };

    await cache.set(entry);

    return cacheEntryToEffectivePermissions(entry);
  }

  async function can(
    userId: string,
    siteId: string,
    permissionCode: string,
    options: ResolveOptions = {},
  ): Promise<boolean> {
    const decision = await evaluateGuardrail(
      userId,
      siteId,
      permissionCode,
      options,
    );
    return decision.allowed;
  }

  async function evaluateGuardrail(
    userId: string,
    siteId: string,
    permissionCode: string,
    options: ResolveOptions = {},
  ): Promise<GuardrailDecision> {
    const effective = await getEffectivePermissions(userId, siteId, options);
    const hasPermission = new Set(effective.permissions).has(permissionCode);

    const orderedPolicies = effective.guardrails
      .filter((policy) => policy.permissionCode === permissionCode)
      .sort((a, b) => a.priority - b.priority);

    for (const policy of orderedPolicies) {
      if (!matchesConditions(policy.conditions, { userId, siteId, roleCodes: effective.roleCodes })) {
        continue;
      }

      if (policy.effect === "deny") {
        return {
          allowed: false,
          reason: "policy_deny",
          matchedPolicyId: policy.id,
        };
      }

      return {
        allowed: true,
        reason: "policy_allow",
        matchedPolicyId: policy.id,
      };
    }

    return {
      allowed: hasPermission,
      reason: hasPermission ? "granted" : "missing_permission",
    };
  }

  async function invalidateUserSite(userId: string, siteId: string): Promise<void> {
    await cache.invalidateUserSite(userId, siteId);
  }

  async function invalidateSite(siteId: string): Promise<void> {
    await cache.invalidateSite(siteId);
  }

  async function clearCache(): Promise<void> {
    await cache.clear();
  }

  return {
    getEffectivePermissions,
    can,
    evaluateGuardrail,
    invalidateUserSite,
    invalidateSite,
    clearCache,
  };
}

function cacheEntryToEffectivePermissions(entry: RbacCacheEntry): EffectivePermissions {
  return {
    userId: entry.userId,
    siteId: entry.siteId,
    roleCodes: entry.roleCodes,
    permissions: entry.permissions,
    guardrails: entry.guardrails,
    fetchedAt: entry.fetchedAt,
  };
}

async function fetchRoleCodes(
  supabase: SupabaseClient,
  userId: string,
  siteId: string,
  now: Date,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("tenant_user_roles")
    .select("expires_at, tenant_roles!inner(code, active)")
    .eq("site_id", siteId)
    .eq("user_id", userId)
    .eq("active", true)
    .eq("tenant_roles.active", true)
    .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`);

  if (error) {
    throw error;
  }

  const roleCodes = new Set<string>();
  for (const row of (data ?? []) as unknown[]) {
    const rawRole = getRecordValue(getRecord(row), "tenant_roles");
    const role = getRecord(rawRole);
    const code = getStringValue(role, "code");
    if (code) {
      roleCodes.add(code);
    }
  }

  const fallbackRole = await fetchLegacyRole(supabase, userId, siteId);
  if (fallbackRole) {
    roleCodes.add(fallbackRole);
  }

  return [...roleCodes];
}

async function fetchRolePermissions(
  supabase: SupabaseClient,
  userId: string,
  siteId: string,
  now: Date,
): Promise<string[]> {
  const roleIds = await fetchActiveRoleIds(supabase, userId, siteId, now);
  if (roleIds.length === 0) {
    const fallbackRole = await fetchLegacyRole(supabase, userId, siteId);
    return fallbackRole ? [...(ROLE_PERMISSION_FALLBACK[fallbackRole] ?? [])] : [];
  }

  const { data, error } = await supabase
    .from("tenant_role_permissions")
    .select("permissions!inner(code)")
    .in("tenant_role_id", roleIds);

  if (error) {
    throw error;
  }

  const permissionCodes = new Set<string>();
  for (const row of (data ?? []) as unknown[]) {
    const rawPermission = getRecordValue(getRecord(row), "permissions");
    const permission = getRecord(rawPermission);
    const code = getStringValue(permission, "code");
    if (code) {
      permissionCodes.add(code);
    }
  }

  const fallbackRole = await fetchLegacyRole(supabase, userId, siteId);
  for (const code of ROLE_PERMISSION_FALLBACK[fallbackRole ?? ""] ?? []) {
    permissionCodes.add(code);
  }

  return [...permissionCodes];
}

async function fetchActiveRoleIds(
  supabase: SupabaseClient,
  userId: string,
  siteId: string,
  now: Date,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("tenant_user_roles")
    .select("tenant_role_id, expires_at")
    .eq("site_id", siteId)
    .eq("user_id", userId)
    .eq("active", true)
    .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`);

  if (error) {
    throw error;
  }

  const roleIds: string[] = [];
  for (const row of (data ?? []) as unknown[]) {
    const roleId = getStringValue(getRecord(row), "tenant_role_id");
    if (roleId) {
      roleIds.push(roleId);
    }
  }

  return roleIds;
}

async function fetchLegacyRole(
  supabase: SupabaseClient,
  userId: string,
  siteId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("site_users")
    .select("role")
    .eq("id", userId)
    .eq("site_id", siteId)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return getStringValue(getRecord(data), "role") ?? null;
}

async function fetchGuardrails(supabase: SupabaseClient, siteId: string): Promise<GuardrailPolicy[]> {
  const { data, error } = await supabase
    .from("tenant_permission_policies")
    .select("id, effect, priority, conditions, permissions!inner(code)")
    .eq("site_id", siteId)
    .eq("active", true)
    .order("priority", { ascending: true });

  if (error) {
    throw error;
  }

  const policies: GuardrailPolicy[] = [];

  for (const row of (data ?? []) as unknown[]) {
    const record = getRecord(row);
    const id = getStringValue(record, "id");
    const effect = getStringValue(record, "effect");
    const priority = getNumberValue(record, "priority") ?? 100;
    const conditions = getRecordValue(record, "conditions");

    const rawPermission = getRecordValue(record, "permissions");
    const permissionCode = getStringValue(getRecord(rawPermission), "code");

    if (!id || !permissionCode || (effect !== "allow" && effect !== "deny")) {
      continue;
    }

    policies.push({
      id,
      permissionCode,
      effect,
      priority,
      conditions: isRecord(conditions) ? conditions : {},
    });
  }

  return policies;
}

function applyGuardrailMaterialization(
  permissionSet: Set<string>,
  guardrails: GuardrailPolicy[],
  context: { userId: string; siteId: string; roleCodes: string[] },
): void {
  const sorted = [...guardrails].sort((a, b) => a.priority - b.priority);

  for (const policy of sorted) {
    if (!matchesConditions(policy.conditions, context)) {
      continue;
    }

    if (policy.effect === "deny") {
      permissionSet.delete(policy.permissionCode);
      continue;
    }

    permissionSet.add(policy.permissionCode);
  }
}

function matchesConditions(
  conditions: Record<string, unknown>,
  context: { userId: string; siteId: string; roleCodes: string[] },
): boolean {
  if (Object.keys(conditions).length === 0) {
    return true;
  }

  const roleCodesAny = asStringArray(conditions["roleCodesAny"]);
  if (roleCodesAny && !roleCodesAny.some((code) => context.roleCodes.includes(code))) {
    return false;
  }

  const roleCodesAll = asStringArray(conditions["roleCodesAll"]);
  if (roleCodesAll && !roleCodesAll.every((code) => context.roleCodes.includes(code))) {
    return false;
  }

  const userIds = asStringArray(conditions["userIds"]);
  if (userIds && !userIds.includes(context.userId)) {
    return false;
  }

  const siteIds = asStringArray(conditions["siteIds"]);
  if (siteIds && !siteIds.includes(context.siteId)) {
    return false;
  }

  return true;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const values = value.filter((item): item is string => typeof item === "string");
  return values.length > 0 ? values : null;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function getRecord(value: unknown): UnknownRecord {
  if (isRecord(value)) {
    return value;
  }

  return {};
}

function getRecordValue(record: UnknownRecord, key: string): unknown {
  return record[key];
}

function getStringValue(record: UnknownRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function getNumberValue(record: UnknownRecord, key: string): number | null {
  const value = record[key];
  return typeof value === "number" ? value : null;
}
