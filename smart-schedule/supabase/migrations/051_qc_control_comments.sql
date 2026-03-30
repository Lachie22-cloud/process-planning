-- Add comment fields for QC / P&C Controls toggles
ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS observation_comment text,
  ADD COLUMN IF NOT EXISTS ebr_comment text;
