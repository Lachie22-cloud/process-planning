-- Per-batch per-day overrides for the Filling Day Plan: comments, hold-up notes, manual sort order
CREATE TABLE IF NOT EXISTS batch_day_plan_overrides (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  batch_id     uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  plan_date    date NOT NULL,
  comment      text,
  hold_up_note text,
  sort_order   integer,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, batch_id, plan_date)
);

ALTER TABLE batch_day_plan_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "batch_day_plan_overrides_select" ON batch_day_plan_overrides
  FOR SELECT USING (auth.has_permission('batches.read', site_id));

CREATE POLICY "batch_day_plan_overrides_write" ON batch_day_plan_overrides
  FOR ALL USING (auth.has_permission('batches.write', site_id))
  WITH CHECK (auth.has_permission('batches.write', site_id));
