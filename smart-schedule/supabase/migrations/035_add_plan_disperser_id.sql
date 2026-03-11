-- Add plan_disperser_id column so batches can be assigned to both a mixer AND a disperser
ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS plan_disperser_id uuid REFERENCES resources(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_batches_plan_disperser_id ON batches(plan_disperser_id);

COMMENT ON COLUMN batches.plan_disperser_id IS 'Disperser resource assigned during import (separate from primary plan_resource_id which is the mixer)';
