-- 073_fix_production_substitution_rule_access.sql
--
-- Root cause: production users (role='member' with tenant RBAC 'production' role)
-- cannot move batches to alternate mixers even when a substitution rule permits it.
-- Two independent failure points exist — both must be fixed:
--
-- 1. FRONTEND (RLS on substitution_rules SELECT):
--    useSubstitutionRules() queries substitution_rules directly from the browser.
--    The RLS policy only allows SELECT if auth.has_permission('rules.read', site_id).
--    For production users, auth.has_permission() must succeed via RBAC v2 lookup
--    (tenant_user_roles → tenant_role_permissions → permissions). If the JWT user_id
--    does not resolve correctly to a tenant_user_roles entry at query time, the RLS
--    check returns FALSE, the query returns 0 rows, and evaluateDropTarget() (since
--    commit f5733ed removed the substitutionRules.length > 0 guard) blocks ALL
--    cross-resource moves.
--
--    Fix: also allow SELECT when the user has 'batches.schedule', which production
--    users reliably hold (seeded by migration 011, restored by migration 066).
--
-- 2. DB TRIGGER (enforce_batch_substitution_rule SECURITY INVOKER):
--    The trigger fires with the calling user's RLS context. In that context,
--    auth.has_permission('rules.read', site_id) may again fail for production
--    users (same JWT resolution issue as above), causing the trigger's SELECT
--    from substitution_rules to return 0 rows and raise the "No substitution
--    rule allows this mixer change" exception — even though a valid rule exists.
--    Planners (site_admin legacy role) never hit this because their legacy
--    fallback returns unconditional TRUE for every permission.
--
--    Fix: recreate enforce_batch_substitution_rule() as SECURITY DEFINER so it
--    runs with the function owner's privileges and always sees substitution_rules,
--    bypassing the caller's RLS entirely.

-- ============================================================
-- 1. Expand substitution_rules SELECT policy to include batches.schedule
-- ============================================================
DROP POLICY IF EXISTS substitution_rules_select ON substitution_rules;

CREATE POLICY substitution_rules_select ON substitution_rules
  FOR SELECT
  USING (
    auth.has_permission('rules.read', site_id)
    OR auth.has_permission('batches.schedule', site_id)
  );

-- ============================================================
-- 2. Recreate trigger function as SECURITY DEFINER
--    Body is identical to migration 038 — only the security context changes.
-- ============================================================
CREATE OR REPLACE FUNCTION enforce_batch_substitution_rule()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed BOOLEAN;
BEGIN
  -- New inserts and first-time assignments are allowed. This guard only applies
  -- when an already-assigned batch is moved to a different resource.
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF NEW.plan_resource_id IS NULL
     OR OLD.plan_resource_id IS NULL
     OR NEW.plan_resource_id = OLD.plan_resource_id THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM substitution_rules sr
    WHERE sr.site_id = NEW.site_id
      AND sr.enabled = TRUE
      AND (sr.source_resource_id IS NULL OR sr.source_resource_id = OLD.plan_resource_id)
      AND (sr.target_resource_id IS NULL OR sr.target_resource_id = NEW.plan_resource_id)
      AND (
        sr.conditions IS NULL
        OR (
          (
            NOT (sr.conditions ? 'maxVolume')
            OR NEW.batch_volume IS NULL
            OR NEW.batch_volume <= (sr.conditions->>'maxVolume')::NUMERIC
          )
          AND (
            NOT (sr.conditions ? 'minVolume')
            OR NEW.batch_volume IS NULL
            OR NEW.batch_volume >= (sr.conditions->>'minVolume')::NUMERIC
          )
          AND (
            NOT (sr.conditions ? 'colorGroups')
            OR jsonb_array_length(sr.conditions->'colorGroups') = 0
            OR NEW.sap_color_group IS NULL
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(sr.conditions->'colorGroups') AS allowed_group(value)
              WHERE allowed_group.value = NEW.sap_color_group
            )
          )
        )
      )
  )
  INTO v_allowed;

  IF NOT v_allowed THEN
    RAISE EXCEPTION
      USING
        ERRCODE = '23514',
        MESSAGE = 'No substitution rule allows this mixer change';
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger definition is unchanged — only the function security context changed.
DROP TRIGGER IF EXISTS enforce_batch_substitution_rule_on_batches ON batches;

CREATE TRIGGER enforce_batch_substitution_rule_on_batches
  BEFORE INSERT OR UPDATE OF plan_resource_id, batch_volume, sap_color_group ON batches
  FOR EACH ROW
  EXECUTE FUNCTION enforce_batch_substitution_rule();
