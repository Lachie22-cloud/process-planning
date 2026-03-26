-- Add plan_disperser2_id column for batches that have a second dispersion stage
-- Logic: if SAP bulk data has a value in "Dispersion 2 Resource" column, the batch
-- requires two dispersion stages. plan_disperser_id = stage 1, plan_disperser2_id = stage 2.
ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS plan_disperser2_id uuid REFERENCES resources(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_batches_plan_disperser2_id ON batches(plan_disperser2_id);

COMMENT ON COLUMN batches.plan_disperser2_id IS 'Second disperser resource for batches requiring two dispersion stages (imported from Dispersion 2 Resource column)';
