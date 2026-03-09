-- 032_general_schedule_rules.sql
-- Seeds 4 general scheduling preferences for the Rocklea site.
-- These are informational/scoring rules used by AI agent analysis
-- and the health scorer, not hard drag-drop constraints.

BEGIN;

WITH rocklea AS (
  SELECT '00000000-0000-0000-0000-000000000001'::uuid AS site_id
)

INSERT INTO schedule_rules (site_id, name, description, rule_type, conditions, actions, rule_version, schema_id, enabled)
SELECT
  r.site_id,
  v.name,
  v.description,
  v.rule_type,
  v.conditions::jsonb,
  v.actions::jsonb,
  1,
  'schedule-rule/v1',
  TRUE
FROM rocklea r
CROSS JOIN (VALUES
  (
    'RL/BL early in week',
    'Ready-to-fill and bulk-off batches should be scheduled early in the week (Mon-Tue) to allow fill/pack turnaround before Friday dispatch.',
    'schedule',
    '{"preference":"rl_bl_early","days":["monday","tuesday"],"statuses":["Ready to Fill","Bulk Off"]}',
    '{"score_bonus":8,"description":"Prefers RL/BL batches early in week"}'
  ),
  (
    'Thinners 1L weekly limit',
    'Limit thinners 1L batches to a maximum of 2 per week to prevent filling line bottleneck.',
    'schedule',
    '{"check":"weekly_pack_size_limit","pack_size":"1L","material_pattern":"THINNER","max_per_week":2}',
    '{"warn":"weekly_pack_size_exceeded","description":"Max 2 thinners 1L batches per week"}'
  ),
  (
    'Batch taper to Friday',
    'Schedule volume should taper towards the end of the week to allow for rework and catch-up.',
    'schedule',
    '{"preference":"batch_taper","direction":"descending","measure":"batch_count"}',
    '{"score_bonus":5,"description":"Prefers decreasing batch count Mon→Fri"}'
  ),
  (
    'Sales order low stock cover priority',
    'Batches with stock cover below safety stock level should be prioritised for earlier scheduling.',
    'schedule',
    '{"preference":"so_low_cov","threshold":"safety_stock","measure":"stock_cover"}',
    '{"score_bonus":12,"description":"Prioritise low stock-cover batches"}'
  )
) AS v(name, description, rule_type, conditions, actions)
WHERE NOT EXISTS (
  SELECT 1 FROM schedule_rules sr
  WHERE sr.site_id = r.site_id AND sr.name = v.name
);

COMMIT;
