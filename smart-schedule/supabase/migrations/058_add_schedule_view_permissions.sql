-- 058_add_schedule_view_permissions.sql
-- Add granular schedule week navigation permissions.

INSERT INTO permissions (code, description)
VALUES
  ('schedule.view_past', 'View past weeks'),
  ('schedule.view_current', 'View current week'),
  ('schedule.view_future', 'View future weeks')
ON CONFLICT (code)
DO UPDATE SET description = EXCLUDED.description;
