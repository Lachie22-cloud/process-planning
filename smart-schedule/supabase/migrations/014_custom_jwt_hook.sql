-- 014_custom_jwt_hook.sql
-- Custom JWT hook, bootstrap-friendly site_users policy, and pending invite binding RPC.

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
    -- Inject custom tenant claims.
    -- IMPORTANT: Use 'app_role' key (not 'role') to avoid clobbering the
    -- GoTrue 'role' claim ("authenticated") that PostgREST uses for DB role switching.
    v_claims := jsonb_set(v_claims, '{site_id}', to_jsonb(v_site_user.site_id::TEXT), TRUE);
    v_claims := jsonb_set(v_claims, '{user_id}', to_jsonb(v_site_user.id::TEXT), TRUE);
    v_claims := jsonb_set(v_claims, '{app_role}', to_jsonb(v_site_user.app_role), TRUE);
  ELSE
    -- User not provisioned: strip only custom claims, never GoTrue's own claims.
    v_claims := v_claims - 'site_id' - 'user_id' - 'app_role';
  END IF;

  RETURN jsonb_set(event, '{claims}', v_claims, TRUE);
EXCEPTION WHEN OTHERS THEN
  -- Never crash GoTrue — return the event unchanged on any error.
  RETURN event;
END;
$$;

REVOKE ALL ON FUNCTION public.custom_access_token_hook(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB) TO supabase_auth_admin;

-- ============================================================
-- UPDATE AUTH HELPER FUNCTIONS
-- The hook injects 'app_role' (not 'role') to avoid clobbering GoTrue's
-- reserved 'role' claim ("authenticated") used by PostgREST for DB role switching.
-- Rewrite is_super_admin() and is_admin() to read 'app_role'.
-- user_site_id() and current_user_id() remain unchanged (they read 'site_id'/'user_id').
-- ============================================================
CREATE OR REPLACE FUNCTION auth.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', TRUE)::jsonb ->> 'app_role') = 'super_admin',
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION auth.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', TRUE)::jsonb ->> 'app_role') IN ('super_admin', 'site_admin'),
    FALSE
  );
$$;

-- ============================================================
-- BOOTSTRAP-FRIENDLY site_users SELECT POLICY
-- Adds an OR branch that works with only standard GoTrue claims (sub, email)
-- so that site_provider can load the user's row on first login before the
-- hook has injected custom claims.
-- ============================================================
DROP POLICY IF EXISTS site_users_select ON site_users;

CREATE POLICY site_users_select ON site_users FOR SELECT
  USING (
    id = auth.current_user_id()
    OR auth.has_permission('admin.users', site_id)
    OR external_id = COALESCE(
      NULLIF(current_setting('request.jwt.claims', TRUE)::jsonb ->> 'sub', ''),
      NULLIF(current_setting('request.jwt.claims', TRUE)::jsonb ->> 'user_id', '')
    )
    OR (
      external_id LIKE 'pending:%'
      AND lower(email) = lower(COALESCE(
        NULLIF(current_setting('request.jwt.claims', TRUE)::jsonb ->> 'email', ''),
        ''
      ))
    )
  );

CREATE OR REPLACE FUNCTION public.bind_pending_invite(
  p_external_id TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_external_id TEXT;
  v_email TEXT;
  v_candidate_count INTEGER := 0;
  v_bound_count INTEGER := 0;
BEGIN
  v_external_id := COALESCE(
    NULLIF(trim(p_external_id), ''),
    NULLIF(current_setting('request.jwt.claims', TRUE)::jsonb ->> 'sub', ''),
    NULLIF(current_setting('request.jwt.claims', TRUE)::jsonb ->> 'user_id', '')
  );
  v_email := lower(trim(COALESCE(
    NULLIF(p_email, ''),
    NULLIF(current_setting('request.jwt.claims', TRUE)::jsonb ->> 'email', '')
  )));

  IF v_external_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Missing external_id');
  END IF;

  IF v_email IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Missing email');
  END IF;

  SELECT COUNT(*)
  INTO v_candidate_count
  FROM site_users su
  WHERE su.active = TRUE
    AND su.external_id LIKE 'pending:%'
    AND lower(su.email) = v_email;

  WITH updated AS (
    UPDATE site_users su
    SET external_id = v_external_id,
        active = TRUE,
        updated_at = NOW()
    WHERE su.active = TRUE
      AND su.external_id LIKE 'pending:%'
      AND lower(su.email) = v_email
      AND NOT EXISTS (
        SELECT 1
        FROM site_users existing
        WHERE existing.site_id = su.site_id
          AND existing.external_id = v_external_id
          AND existing.id <> su.id
      )
    RETURNING su.id
  )
  SELECT COUNT(*) INTO v_bound_count FROM updated;

  RETURN jsonb_build_object(
    'success', TRUE,
    'external_id', v_external_id,
    'email', v_email,
    'candidates', v_candidate_count,
    'bound', v_bound_count,
    'skipped_conflicts', GREATEST(v_candidate_count - v_bound_count, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bind_pending_invite(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bind_pending_invite(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bind_pending_invite(TEXT, TEXT) TO service_role;
