-- Migration: Streamline batch statuses
-- Consolidates statuses into Production flow + Variable statuses
-- Production: Planned → In Progress → In Lab → On Test → Ready to Fill → Filling → Job Complete
-- Variable:   NCB, OFF Rework, OFF WOM, OFF WOP, Hold

-- Step 1: Add new columns for excess paint and bulk off comments
ALTER TABLE batches ADD COLUMN IF NOT EXISTS excess_paint_comment TEXT;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS bulk_off_comment TEXT;

-- Step 2: Migrate existing status values to new statuses
-- "Complete" → "Job Complete"
UPDATE batches SET status = 'Job Complete' WHERE status = 'Complete';

-- "Rework" → "OFF Rework"
UPDATE batches SET status = 'OFF Rework' WHERE status = 'Rework';

-- "WOM" → "OFF WOM"
UPDATE batches SET status = 'OFF WOM' WHERE status = 'WOM';

-- "WOP" → "OFF WOP"
UPDATE batches SET status = 'OFF WOP' WHERE status = 'WOP';

-- "OFF" → "OFF Rework" (generic OFF becomes OFF Rework as closest match)
UPDATE batches SET status = 'OFF Rework' WHERE status = 'OFF';

-- "Bulk Off" → "OFF Rework" (bulk off is part of rework flow now)
-- Preserve the status comment as bulk_off_comment
UPDATE batches
SET status = 'OFF Rework',
    bulk_off_comment = status_comment
WHERE status = 'Bulk Off';

-- "Excess Paint" → "Job Complete" with excess_paint_comment
UPDATE batches
SET status = 'Job Complete',
    excess_paint_comment = status_comment
WHERE status = 'Excess Paint';

-- "Cancelled" → "Hold" (closest match for cancelled jobs)
UPDATE batches SET status = 'Hold' WHERE status = 'Cancelled';

-- Step 3: Drop old CHECK constraint and add new one
ALTER TABLE batches DROP CONSTRAINT IF EXISTS batches_status_check;
ALTER TABLE batches ADD CONSTRAINT batches_status_check
  CHECK (status IN (
    'Planned', 'In Progress', 'In Lab', 'On Test',
    'Ready to Fill', 'Filling', 'Job Complete',
    'NCB', 'OFF Rework', 'OFF WOM', 'OFF WOP', 'Hold'
  ));
