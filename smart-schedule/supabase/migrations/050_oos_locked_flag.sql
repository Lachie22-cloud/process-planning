-- 050_oos_locked_flag.sql: Add oos_locked flag to batch_coverage_items
-- Once a coverage item is flagged as "Stock Out", oos_locked is set to TRUE.
-- Locked OOS items persist across re-imports until the batch reaches "Job Complete".

ALTER TABLE batch_coverage_items
  ADD COLUMN IF NOT EXISTS oos_locked BOOLEAN NOT NULL DEFAULT FALSE;
