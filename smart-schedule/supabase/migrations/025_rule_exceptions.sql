-- 025_rule_exceptions.sql
-- Temporary rule exceptions allowing site admins to suspend,
-- override, or modify schedule rules for specific time periods.

BEGIN;

-- ============================================================
-- 1) rule_exceptions table
-- ============================================================
CREATE TABLE IF NOT EXISTS rule_exceptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  rule_id         UUID NOT NULL REFERENCES schedule_rules(id) ON DELETE CASCADE,
  reason          TEXT NOT NULL,
  exception_type  TEXT NOT NULL CHECK (exception_type IN ('suspend', 'override', 'modify')),
  override_config JSONB DEFAULT '{}'::jsonb,
  starts_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_rule_exception_expiry CHECK (expires_at IS NULL OR expires_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_rule_exceptions_site
  ON rule_exceptions (site_id);

CREATE INDEX IF NOT EXISTS idx_rule_exceptions_rule
  ON rule_exceptions (rule_id);

-- No partial index with NOW() — filter active exceptions at query time instead
CREATE INDEX IF NOT EXISTS idx_rule_exceptions_expiry
  ON rule_exceptions (site_id, expires_at);

-- ============================================================
-- 2) RLS
-- ============================================================
ALTER TABLE rule_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY rule_exceptions_select
  ON rule_exceptions FOR SELECT
  USING (site_id = auth.user_site_id() OR auth.is_super_admin());

CREATE POLICY rule_exceptions_insert
  ON rule_exceptions FOR INSERT
  WITH CHECK (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

CREATE POLICY rule_exceptions_update
  ON rule_exceptions FOR UPDATE
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

CREATE POLICY rule_exceptions_delete
  ON rule_exceptions FOR DELETE
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

-- ============================================================
-- 3) Enable realtime
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE rule_exceptions;

COMMIT;
