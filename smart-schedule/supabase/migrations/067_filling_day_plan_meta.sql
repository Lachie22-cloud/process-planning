-- Stores team leader assignments per trunk per day for the Filling Day Plan feature
CREATE TABLE IF NOT EXISTS filling_day_plan_meta (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  plan_date     date NOT NULL,
  trunk_leaders jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, plan_date)
);

ALTER TABLE filling_day_plan_meta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "filling_day_plan_meta_select" ON filling_day_plan_meta
  FOR SELECT USING (auth.has_permission('batches.read', site_id));

CREATE POLICY "filling_day_plan_meta_write" ON filling_day_plan_meta
  FOR ALL USING (auth.has_permission('batches.write', site_id))
  WITH CHECK (auth.has_permission('batches.write', site_id));
