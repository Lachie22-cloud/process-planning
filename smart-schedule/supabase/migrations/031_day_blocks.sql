-- Day blocks: block entire production days for a site
CREATE TABLE IF NOT EXISTS day_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  block_date date NOT NULL,
  reason text,
  created_by uuid REFERENCES site_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, block_date)
);

-- RLS
ALTER TABLE day_blocks ENABLE ROW LEVEL SECURITY;

-- Read: anyone with rules.read for the site
CREATE POLICY "day_blocks_select" ON day_blocks
  FOR SELECT USING (auth.has_permission('rules.read', site_id));

-- Insert: admin only
CREATE POLICY "day_blocks_insert" ON day_blocks
  FOR INSERT WITH CHECK (auth.has_permission('admin.settings', site_id));

-- Delete: admin only
CREATE POLICY "day_blocks_delete" ON day_blocks
  FOR DELETE USING (auth.has_permission('admin.settings', site_id));
