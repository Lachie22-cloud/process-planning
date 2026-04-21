-- Routes fill orders from a batch to specific trunk lines for the Filling Day Plan pack-size split feature
CREATE TABLE IF NOT EXISTS batch_trunk_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  batch_id       uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  plan_date      date NOT NULL,
  trunk_line     text NOT NULL,
  fill_order_ids uuid[] NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, batch_id, plan_date, trunk_line)
);

ALTER TABLE batch_trunk_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "batch_trunk_assignments_select" ON batch_trunk_assignments
  FOR SELECT USING (auth.has_permission('batches.read', site_id));

CREATE POLICY "batch_trunk_assignments_write" ON batch_trunk_assignments
  FOR ALL USING (auth.has_permission('batches.write', site_id))
  WITH CHECK (auth.has_permission('batches.write', site_id));
