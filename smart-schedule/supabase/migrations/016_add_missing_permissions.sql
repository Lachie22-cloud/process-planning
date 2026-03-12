-- 016_add_missing_permissions.sql
-- Add permission codes referenced in the permission document but missing from the catalog.

INSERT INTO permissions (code, description)
VALUES
  ('planning.export', 'Export planning data (CSV/Excel)'),
  ('planning.ai', 'Use AI-assisted scheduling tools'),
  ('alerts.write', 'Create and edit alerts')
ON CONFLICT (code)
DO UPDATE SET description = EXCLUDED.description;
