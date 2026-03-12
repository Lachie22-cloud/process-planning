-- Add extra batch detail fields visible in the batch detail sheet
ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS bulk_batch_number text,
  ADD COLUMN IF NOT EXISTS premix_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ipt numeric,
  ADD COLUMN IF NOT EXISTS fill_requirement text DEFAULT 'Standard',
  ADD COLUMN IF NOT EXISTS observation_required boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS ebr_batch boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS physical_location text;
