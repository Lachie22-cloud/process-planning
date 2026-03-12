-- =====================================================
-- Migration 037: Configurable AI Scan Types
--
-- Moves the four hardcoded scan types into a table
-- so site admins can edit, disable, or add new ones.
-- =====================================================

-- 1. New table
CREATE TABLE IF NOT EXISTS ai_scan_types (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  label        TEXT NOT NULL,
  description  TEXT,
  ai_objective TEXT,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_ai_scan_types_site_key UNIQUE (site_id, key)
);

CREATE INDEX IF NOT EXISTS idx_ai_scan_types_site_enabled
  ON ai_scan_types(site_id, enabled);

ALTER TABLE ai_scan_types ENABLE ROW LEVEL SECURITY;

-- 2. RLS policies (matches wiki_articles pattern)
CREATE POLICY ai_scan_types_select ON ai_scan_types FOR SELECT
  USING (
    auth.has_permission('planning.ai', site_id)
    OR auth.has_permission('admin.settings', site_id)
  );

CREATE POLICY ai_scan_types_insert ON ai_scan_types FOR INSERT
  WITH CHECK (auth.has_permission('admin.settings', site_id));

CREATE POLICY ai_scan_types_update ON ai_scan_types FOR UPDATE
  USING (auth.has_permission('admin.settings', site_id))
  WITH CHECK (auth.has_permission('admin.settings', site_id));

CREATE POLICY ai_scan_types_delete ON ai_scan_types FOR DELETE
  USING (auth.has_permission('admin.settings', site_id));

-- 3. Seed defaults for all existing sites
INSERT INTO ai_scan_types (site_id, key, label, description, ai_objective, enabled, is_default, sort_order)
SELECT
  s.id,
  v.key,
  v.label,
  v.description,
  v.ai_objective,
  TRUE,
  TRUE,
  v.sort_order
FROM sites s
CROSS JOIN (VALUES
  ('schedule_optimization', 'Schedule Optimisation', 'Analyse schedule for efficiency improvements',
   'Find schedule bottlenecks and produce optimization recommendations.', 1),
  ('rule_analysis', 'Rule Analysis', 'Review substitution and scheduling rules',
   'Review planning rules and identify conflicts or inefficiencies.', 2),
  ('capacity_check', 'Capacity Check', 'Check resource capacity and utilisation',
   'Check resource capacity constraints and identify overload/underutilization.', 3),
  ('full_audit', 'Full Audit', 'Comprehensive analysis of all aspects',
   'Perform a full planning audit and summarize top risks and actions.', 4)
) AS v(key, label, description, ai_objective, sort_order)
ON CONFLICT (site_id, key) DO NOTHING;

-- 4. Auto-seed defaults when a new site is created
CREATE OR REPLACE FUNCTION seed_ai_scan_types_for_site()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO ai_scan_types (site_id, key, label, description, ai_objective, enabled, is_default, sort_order)
  VALUES
    (NEW.id, 'schedule_optimization', 'Schedule Optimisation', 'Analyse schedule for efficiency improvements',
     'Find schedule bottlenecks and produce optimization recommendations.', TRUE, TRUE, 1),
    (NEW.id, 'rule_analysis', 'Rule Analysis', 'Review substitution and scheduling rules',
     'Review planning rules and identify conflicts or inefficiencies.', TRUE, TRUE, 2),
    (NEW.id, 'capacity_check', 'Capacity Check', 'Check resource capacity and utilisation',
     'Check resource capacity constraints and identify overload/underutilization.', TRUE, TRUE, 3),
    (NEW.id, 'full_audit', 'Full Audit', 'Comprehensive analysis of all aspects',
     'Perform a full planning audit and summarize top risks and actions.', TRUE, TRUE, 4)
  ON CONFLICT (site_id, key) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION protect_default_ai_scan_types()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_default THEN
    RAISE EXCEPTION 'Default AI scan types cannot be deleted';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.is_default AND NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION 'Default AI scan type keys cannot be changed';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_seed_ai_scan_types ON sites;
CREATE TRIGGER trg_seed_ai_scan_types
  AFTER INSERT ON sites
  FOR EACH ROW
  EXECUTE FUNCTION seed_ai_scan_types_for_site();

DROP TRIGGER IF EXISTS trg_protect_default_ai_scan_types ON ai_scan_types;
CREATE TRIGGER trg_protect_default_ai_scan_types
  BEFORE UPDATE OR DELETE ON ai_scan_types
  FOR EACH ROW
  EXECUTE FUNCTION protect_default_ai_scan_types();

-- 5. Drop CHECK constraints on scan_type columns so custom types are allowed
ALTER TABLE ai_scans DROP CONSTRAINT IF EXISTS ai_scans_scan_type_check;
ALTER TABLE ai_scheduled_tasks DROP CONSTRAINT IF EXISTS ai_scheduled_tasks_task_type_check;
