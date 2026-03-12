-- 008_sites_admin_update.sql: Allow site admins to update their own site settings

DROP POLICY IF EXISTS sites_update ON sites;

CREATE POLICY sites_update ON sites FOR UPDATE
  USING (
    auth.is_super_admin()
    OR (id = auth.user_site_id() AND auth.is_admin())
  );
