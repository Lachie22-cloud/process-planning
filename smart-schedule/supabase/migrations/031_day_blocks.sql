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

-- Read: any authenticated user in the site
CREATE POLICY "day_blocks_select" ON day_blocks
  FOR SELECT USING (
    site_id IN (SELECT site_id FROM site_users WHERE user_id = auth.uid())
  );

-- Insert: site_admin / super_admin only (via app_role in JWT)
CREATE POLICY "day_blocks_insert" ON day_blocks
  FOR INSERT WITH CHECK (
    site_id IN (
      SELECT site_id FROM site_users
      WHERE user_id = auth.uid()
        AND role IN ('site_admin', 'super_admin')
    )
  );

-- Delete: site_admin / super_admin only
CREATE POLICY "day_blocks_delete" ON day_blocks
  FOR DELETE USING (
    site_id IN (
      SELECT site_id FROM site_users
      WHERE user_id = auth.uid()
        AND role IN ('site_admin', 'super_admin')
    )
  );
