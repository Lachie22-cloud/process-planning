-- 018_substitution_generation_settings.sql
-- Site-level substitution rule generation settings.
-- Stores configurable generation behaviour so site admins can control
-- how auto-generated substitution rules are created without code changes.

BEGIN;

-- ============================================================
-- 1) Create the settings table
-- ============================================================
CREATE TABLE IF NOT EXISTS substitution_generation_settings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  config     JSONB NOT NULL DEFAULT '{}'::jsonb,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_by UUID REFERENCES site_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One settings row per site
  CONSTRAINT uq_substitution_generation_settings_site UNIQUE (site_id)
);

-- Index for fast lookup by site
CREATE INDEX IF NOT EXISTS idx_subst_gen_settings_site
  ON substitution_generation_settings (site_id);

-- ============================================================
-- 2) Enable RLS
-- ============================================================
ALTER TABLE substitution_generation_settings ENABLE ROW LEVEL SECURITY;

-- SELECT: site members can read their own site settings; super_admin reads all
CREATE POLICY subst_gen_settings_select
  ON substitution_generation_settings FOR SELECT
  USING (site_id = auth.user_site_id() OR auth.is_super_admin());

-- INSERT: site admins can create settings for their site; super_admin for any
CREATE POLICY subst_gen_settings_insert
  ON substitution_generation_settings FOR INSERT
  WITH CHECK (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

-- UPDATE: site admins can update their site settings; super_admin for any
CREATE POLICY subst_gen_settings_update
  ON substitution_generation_settings FOR UPDATE
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

-- DELETE: site admins can delete settings for their site; super_admin for any
CREATE POLICY subst_gen_settings_delete
  ON substitution_generation_settings FOR DELETE
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

-- ============================================================
-- 3) Auto-update updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_subst_gen_settings_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_subst_gen_settings_updated_at
  BEFORE UPDATE ON substitution_generation_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_subst_gen_settings_timestamp();

-- ============================================================
-- 4) Seed default settings for the Rocklea site
-- ============================================================
INSERT INTO substitution_generation_settings (site_id, enabled, config, version)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  TRUE,
  '{
    "scope": {
      "sameGroup": true,
      "crossGroup": false,
      "crossTrunkLine": false,
      "crossChemicalBase": false
    },
    "capacityStrategy": {
      "sameCapacityTemplate": null,
      "largeToSmallTemplate": "maxVolume",
      "smallToLargeTemplate": "minVolume",
      "applyBothMinMax": false
    },
    "resourceEligibility": {
      "includeInactive": false,
      "excludeMissingFields": true,
      "groupByKey": "group"
    },
    "safety": {
      "duplicatePolicy": "skip",
      "disabledCountAsDuplicates": false,
      "previewModeDefault": true
    },
    "conditionTemplates": {
      "minVolume": true,
      "maxVolume": true,
      "colourGroups": false
    }
  }'::jsonb,
  1
)
ON CONFLICT (site_id) DO NOTHING;

-- ============================================================
-- 5) Enable realtime for the table
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE substitution_generation_settings;

COMMIT;
