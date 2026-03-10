-- 034_inject_permissions_into_jwt.sql
-- Update the custom_access_token_hook to inject the user's effective
-- permissions into app_metadata.permissions so that downstream services
-- (AI agent, etc.) can authorize without a round-trip to the database.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claims JSONB;
  v_auth_sub TEXT;
  v_auth_email TEXT;
  v_site_user RECORD;
  v_permissions TEXT[];
  v_legacy_permissions TEXT[];
  v_app_metadata JSONB;
BEGIN
  v_auth_sub := COALESCE(
    NULLIF(event ->> 'user_id', ''),
    NULLIF(event #>> '{claims,sub}', '')
  );
  v_auth_email := lower(trim(COALESCE(
    NULLIF(event #>> '{claims,email}', ''),
    NULLIF(event ->> 'email', '')
  )));

  SELECT su.id, su.site_id, su.role AS app_role
  INTO v_site_user
  FROM site_users su
  WHERE su.active = TRUE
    AND (
      su.external_id = v_auth_sub
      OR (
        v_auth_email IS NOT NULL
        AND lower(su.email) = v_auth_email
        AND su.external_id LIKE 'pending:%'
      )
    )
  ORDER BY
    (su.external_id = v_auth_sub) DESC,
    CASE su.role
      WHEN 'super_admin' THEN 3
      WHEN 'site_admin' THEN 2
      ELSE 1
    END DESC,
    su.updated_at DESC
  LIMIT 1;

  v_claims := COALESCE(event -> 'claims', '{}'::jsonb);

  IF FOUND THEN
    v_claims := jsonb_set(v_claims, '{site_id}', to_jsonb(v_site_user.site_id::TEXT), TRUE);
    v_claims := jsonb_set(v_claims, '{user_id}', to_jsonb(v_site_user.id::TEXT), TRUE);
    v_claims := jsonb_set(v_claims, '{app_role}', to_jsonb(v_site_user.app_role), TRUE);

    -- Collect permissions from tenant RBAC
    SELECT COALESCE(array_agg(DISTINCT p.code ORDER BY p.code), ARRAY[]::TEXT[])
    INTO v_permissions
    FROM tenant_user_roles tur
    JOIN tenant_roles tr ON tr.id = tur.tenant_role_id
    JOIN tenant_role_permissions trp ON trp.tenant_role_id = tr.id
    JOIN permissions p ON p.id = trp.permission_id
    WHERE tur.site_id = v_site_user.site_id
      AND tur.user_id = v_site_user.id
      AND tur.active = TRUE
      AND (tur.expires_at IS NULL OR tur.expires_at > NOW())
      AND tr.site_id = v_site_user.site_id
      AND tr.active = TRUE;

    -- Legacy role fallback: merge permissions from site_users.role
    IF v_site_user.app_role IS NOT NULL THEN
      v_legacy_permissions := CASE v_site_user.app_role
        WHEN 'super_admin' THEN ARRAY[
          'batches.read', 'batches.write', 'batches.schedule', 'batches.status',
          'resources.read', 'resources.write',
          'rules.read', 'rules.write',
          'planning.import', 'planning.coverage', 'planning.vet', 'planning.export', 'planning.ai',
          'admin.users', 'admin.settings', 'admin.sites',
          'alerts.read', 'alerts.acknowledge', 'alerts.write'
        ]
        WHEN 'site_admin' THEN ARRAY[
          'batches.read', 'batches.write', 'batches.schedule', 'batches.status',
          'resources.read', 'resources.write',
          'rules.read', 'rules.write',
          'planning.import', 'planning.coverage', 'planning.vet', 'planning.export', 'planning.ai',
          'admin.users', 'admin.settings',
          'alerts.read', 'alerts.acknowledge', 'alerts.write'
        ]
        WHEN 'member' THEN ARRAY[
          'batches.read', 'batches.status',
          'resources.read',
          'rules.read',
          'planning.coverage', 'planning.ai',
          'alerts.read', 'alerts.acknowledge'
        ]
        ELSE ARRAY[]::TEXT[]
      END;

      -- Merge
      SELECT COALESCE(array_agg(DISTINCT code ORDER BY code), ARRAY[]::TEXT[])
      INTO v_permissions
      FROM (
        SELECT unnest(v_permissions) AS code
        UNION
        SELECT unnest(v_legacy_permissions) AS code
      ) combined;
    END IF;

    -- Inject permissions into app_metadata
    v_app_metadata := COALESCE(v_claims -> 'app_metadata', '{}'::jsonb);
    v_app_metadata := jsonb_set(v_app_metadata, '{permissions}', to_jsonb(v_permissions), TRUE);
    IF v_site_user.app_role = 'super_admin' THEN
      v_app_metadata := jsonb_set(v_app_metadata, '{is_super_admin}', 'true'::jsonb, TRUE);
    END IF;
    v_claims := jsonb_set(v_claims, '{app_metadata}', v_app_metadata, TRUE);
  ELSE
    v_claims := v_claims - 'site_id' - 'user_id' - 'app_role';
  END IF;

  RETURN jsonb_set(event, '{claims}', v_claims, TRUE);
EXCEPTION WHEN OTHERS THEN
  RETURN event;
END;
$$;

REVOKE ALL ON FUNCTION public.custom_access_token_hook(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB) TO supabase_auth_admin;
