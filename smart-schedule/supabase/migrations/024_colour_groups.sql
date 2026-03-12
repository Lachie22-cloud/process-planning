-- 024_colour_groups.sql
-- Database-driven colour groups and colour transition rules.
-- Replaces the hardcoded COLOR_GROUPS constant so site admins
-- can configure colour groups and mixing/transition rules per site.

BEGIN;

-- ============================================================
-- 1) colour_groups table
-- ============================================================
CREATE TABLE IF NOT EXISTS colour_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  hex_colour TEXT NOT NULL DEFAULT '#9ca3af',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, code)
);

CREATE INDEX IF NOT EXISTS idx_colour_groups_site
  ON colour_groups (site_id);

-- ============================================================
-- 2) colour_transitions table
-- ============================================================
CREATE TABLE IF NOT EXISTS colour_transitions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  from_group_id    UUID NOT NULL REFERENCES colour_groups(id) ON DELETE CASCADE,
  to_group_id      UUID NOT NULL REFERENCES colour_groups(id) ON DELETE CASCADE,
  allowed          BOOLEAN NOT NULL DEFAULT TRUE,
  requires_washout BOOLEAN NOT NULL DEFAULT FALSE,
  washout_minutes  INTEGER,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, from_group_id, to_group_id)
);

CREATE INDEX IF NOT EXISTS idx_colour_transitions_site
  ON colour_transitions (site_id);

-- ============================================================
-- 3) RLS for colour_groups
-- ============================================================
ALTER TABLE colour_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY colour_groups_select
  ON colour_groups FOR SELECT
  USING (site_id = auth.user_site_id() OR auth.is_super_admin());

CREATE POLICY colour_groups_insert
  ON colour_groups FOR INSERT
  WITH CHECK (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

CREATE POLICY colour_groups_update
  ON colour_groups FOR UPDATE
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

CREATE POLICY colour_groups_delete
  ON colour_groups FOR DELETE
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

-- ============================================================
-- 4) RLS for colour_transitions
-- ============================================================
ALTER TABLE colour_transitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY colour_transitions_select
  ON colour_transitions FOR SELECT
  USING (site_id = auth.user_site_id() OR auth.is_super_admin());

CREATE POLICY colour_transitions_insert
  ON colour_transitions FOR INSERT
  WITH CHECK (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

CREATE POLICY colour_transitions_update
  ON colour_transitions FOR UPDATE
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

CREATE POLICY colour_transitions_delete
  ON colour_transitions FOR DELETE
  USING (
    (site_id = auth.user_site_id() AND auth.is_admin())
    OR auth.is_super_admin()
  );

-- ============================================================
-- 5) Updated_at triggers
-- ============================================================
CREATE OR REPLACE FUNCTION update_colour_groups_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_colour_groups_updated_at
  BEFORE UPDATE ON colour_groups
  FOR EACH ROW EXECUTE FUNCTION update_colour_groups_timestamp();

CREATE OR REPLACE FUNCTION update_colour_transitions_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_colour_transitions_updated_at
  BEFORE UPDATE ON colour_transitions
  FOR EACH ROW EXECUTE FUNCTION update_colour_transitions_timestamp();

-- ============================================================
-- 6) Seed default colour groups for all existing sites
-- ============================================================
INSERT INTO colour_groups (site_id, code, name, hex_colour, sort_order, active)
SELECT s.id, v.code, v.name, v.hex_colour, v.sort_order, TRUE
FROM sites s
CROSS JOIN (VALUES
  ('CGCLR', 'CLEAR',  '#e5e7eb', 0),
  ('CGWHI', 'WHITE',  '#f8f9fa', 1),
  ('CGBRN', 'WARM',   '#d4a574', 2),
  ('CGYEL', 'YELLOW', '#ffd700', 3),
  ('CGRED', 'RED',    '#dc2626', 4),
  ('CGGRN', 'GREEN',  '#16a34a', 5),
  ('CGBLU', 'BLUE',   '#2563eb', 6),
  ('CGBLK', 'BLACK',  '#1f2937', 7),
  ('CGOTH', 'OTHER',  '#9ca3af', 8)
) AS v(code, name, hex_colour, sort_order)
ON CONFLICT (site_id, code) DO NOTHING;

-- ============================================================
-- 7) Seed default colour transitions for all existing sites
--    Light-to-dark: allowed without washout
--    Same colour: allowed without washout
--    Dark-to-light: allowed but requires washout
-- ============================================================
INSERT INTO colour_transitions (site_id, from_group_id, to_group_id, allowed, requires_washout, washout_minutes, notes)
SELECT
  f.site_id,
  f.id AS from_group_id,
  t.id AS to_group_id,
  TRUE AS allowed,
  CASE
    WHEN f.sort_order <= t.sort_order THEN FALSE  -- same or lighter-to-darker
    ELSE TRUE                                      -- darker-to-lighter
  END AS requires_washout,
  CASE
    WHEN f.sort_order <= t.sort_order THEN NULL
    ELSE 30
  END AS washout_minutes,
  CASE
    WHEN f.sort_order = t.sort_order THEN 'Same colour group'
    WHEN f.sort_order < t.sort_order THEN 'Light to dark — no washout required'
    ELSE 'Dark to light — washout required'
  END AS notes
FROM colour_groups f
JOIN colour_groups t ON f.site_id = t.site_id
WHERE f.site_id = t.site_id
  AND f.id != t.id
ON CONFLICT (site_id, from_group_id, to_group_id) DO NOTHING;

-- ============================================================
-- 8) Enable realtime
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE colour_groups;
ALTER PUBLICATION supabase_realtime ADD TABLE colour_transitions;

COMMIT;
