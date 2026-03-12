/**
 * RBAC permission checking for the AI agent service.
 * Mirrors the permission model in the main app (use-permissions.ts)
 * and enforces it at the API layer before DB-level RLS kicks in.
 *
 * JWT claims are injected by the custom_access_token_hook in Postgres,
 * which adds app_role, site_id, and user_id at the top level.
 */

export interface JwtUserClaims {
  sub: string;
  email?: string;
  /** Set by custom_access_token_hook */
  site_id?: string;
  user_id?: string;
  app_role?: string;
  /** Fallback locations used by some Supabase setups */
  user_metadata?: {
    site_id?: string;
    role?: string;
  };
  app_metadata?: {
    site_id?: string;
    permissions?: string[];
    is_super_admin?: boolean;
  };
}

/** Permissions required for each AI endpoint */
export const ROUTE_PERMISSIONS = {
  'ai.chat': 'planning.ai',
  'ai.scan': 'planning.ai',
  'ai.sessions': 'planning.ai',
  'ai.drafts.read': 'planning.ai',
  'ai.drafts.approve': 'planning.vet',
  'ai.drafts.reject': 'planning.vet',
  'ai.drafts.apply': 'planning.vet',
  'ai.admin.credentials': 'admin.settings',
  'ai.admin.wiki': 'admin.settings',
  'ai.admin.tasks': 'admin.settings',
  'ai.admin.prompts': 'admin.settings',
} as const;

export type RouteAction = keyof typeof ROUTE_PERMISSIONS;


/**
 * Extracts the site_id from JWT claims.
 * Checks multiple locations since Supabase stores it in different places.
 */
export function extractSiteId(claims: JwtUserClaims): string | null {
  return (
    claims.site_id ??
    claims.app_metadata?.site_id ??
    claims.user_metadata?.site_id ??
    null
  );
}

/**
 * Reads permissions from JWT claims (app_metadata.permissions).
 * Permissions are injected by the custom_access_token_hook at login time,
 * so role changes take effect on the next token refresh without any code deployment.
 */
export function extractPermissions(claims: JwtUserClaims): string[] {
  return claims.app_metadata?.permissions ?? [];
}

/**
 * Checks whether the user is a super admin.
 */
export function isSuperAdmin(claims: JwtUserClaims): boolean {
  return (
    claims.app_role === 'super_admin' ||
    claims.app_metadata?.is_super_admin === true
  );
}

/**
 * Checks if the user has the required permission for a given route action.
 * Super admins bypass all permission checks.
 */
export function hasPermission(claims: JwtUserClaims, action: RouteAction): boolean {
  if (isSuperAdmin(claims)) return true;

  const requiredPermission = ROUTE_PERMISSIONS[action];
  const userPermissions = extractPermissions(claims);

  return userPermissions.includes(requiredPermission);
}

/**
 * Validates that the user has access to the specified site.
 * Returns true if the user's site_id matches the requested site_id,
 * or if the user is a super admin.
 */
export function hasSiteAccess(claims: JwtUserClaims, requestedSiteId: string): boolean {
  if (isSuperAdmin(claims)) return true;

  const userSiteId = extractSiteId(claims);
  return userSiteId === requestedSiteId;
}

/**
 * Combined check: user has both the required permission AND site access.
 */
export function authorise(
  claims: JwtUserClaims,
  action: RouteAction,
  siteId: string
): { allowed: boolean; reason?: string } {
  if (!hasPermission(claims, action)) {
    return {
      allowed: false,
      reason: `Missing required permission: ${ROUTE_PERMISSIONS[action]}`,
    };
  }

  if (!hasSiteAccess(claims, siteId)) {
    return {
      allowed: false,
      reason: 'Access denied: site mismatch',
    };
  }

  return { allowed: true };
}
