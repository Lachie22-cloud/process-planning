-- 023_seed_schedule_rules.sql
-- Seeds the 13 default schedule rules for the Rocklea site.
-- These rules drive resource assignment, capacity validation,
-- colour sequencing, and bulk-specific scheduling behaviour.
-- Rule definitions derived from the original HTML demo specification.

BEGIN;

-- ============================================================
-- Seed schedule rules for Rocklea (idempotent: skip on conflict)
-- ============================================================

-- Insert using a CTE so we can reference site_id once
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
  -- ── General scheduling rules ──────────────────────────────
  (
    'Maximum batches per resource per day',
    'Limits the number of batches that can be scheduled on a single resource per day to the resource''s max_batches_per_day setting.',
    'schedule',
    '{"scope":"resource_day","check":"batch_count_lte_max"}',
    '{"limit":"max_batches_per_day"}'
  ),
  (
    'Minimum batch volume',
    'Rejects batch assignment to a resource if the batch volume is below the resource''s minimum capacity.',
    'schedule',
    '{"check":"batch_volume_gte_resource_min"}',
    '{"reject":"under_capacity"}'
  ),
  (
    'Maximum batch volume',
    'Rejects batch assignment to a resource if the batch volume exceeds the resource''s maximum capacity.',
    'schedule',
    '{"check":"batch_volume_lte_resource_max"}',
    '{"reject":"over_capacity"}'
  ),
  (
    'Resource active check',
    'Prevents scheduling on inactive (decommissioned) resources.',
    'schedule',
    '{"check":"resource_active"}',
    '{"reject":"inactive_resource"}'
  ),
  (
    'Chemical base compatibility',
    'Ensures the batch''s chemical base matches the resource''s configured chemical base (solvent, waterborne, etc.).',
    'schedule',
    '{"check":"chemical_base_match"}',
    '{"reject":"incompatible_base"}'
  ),
  (
    'Prefer same trunk line',
    'Gives a scheduling score bonus when a batch is assigned to a resource on the same trunk line as its material group.',
    'schedule',
    '{"preference":"same_trunk_line"}',
    '{"score_bonus":10}'
  ),
  (
    'Prefer same group',
    'Gives a scheduling score bonus when a batch is assigned to a resource within the same resource group.',
    'schedule',
    '{"preference":"same_group"}',
    '{"score_bonus":5}'
  ),

  -- ── Colour sequencing rules ───────────────────────────────
  (
    'Colour sequence: light to dark',
    'Prefers scheduling batches in light-to-dark colour order on each resource per day. Going dark-to-light incurs a washout penalty.',
    'colour',
    '{"check":"colour_sequence","direction":"light_to_dark"}',
    '{"prefer":"light_to_dark","penalty":"washout"}'
  ),
  (
    'No dark-to-light without washout',
    'Blocks dark-to-light colour transitions on a resource unless a washout slot is scheduled between them.',
    'colour',
    '{"check":"colour_transition_allowed","direction":"dark_to_light"}',
    '{"reject":"dark_to_light_no_washout"}'
  ),

  -- ── Bulk-specific rules ───────────────────────────────────
  (
    'Mixer lock',
    'Locks a specific bulk code to a designated mixer resource. Once set, all batches of that bulk code must use the locked resource.',
    'bulk',
    '{"check":"mixer_lock","scope":"bulk_code"}',
    '{"lock":"assigned_resource"}'
  ),
  (
    'Mixer exclusion',
    'Excludes specific mixer resources from being used for a particular bulk code.',
    'bulk',
    '{"check":"mixer_exclude","scope":"bulk_code"}',
    '{"exclude":"listed_resources"}'
  ),
  (
    'Day restriction',
    'Restricts a bulk code to specific days of the week (e.g., Monday and Thursday only).',
    'bulk',
    '{"check":"day_restriction","scope":"bulk_code"}',
    '{"restrict":"allowed_days"}'
  ),
  (
    'Max per week',
    'Limits the maximum number of batches of a specific bulk code that can be scheduled per week.',
    'bulk',
    '{"check":"max_per_week","scope":"bulk_code"}',
    '{"limit":"weekly_max"}'
  )
) AS v(name, description, rule_type, conditions, actions)
-- Skip if a rule with the same name already exists for this site
WHERE NOT EXISTS (
  SELECT 1 FROM schedule_rules sr
  WHERE sr.site_id = r.site_id AND sr.name = v.name
);

COMMIT;
