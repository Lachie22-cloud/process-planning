-- Add premix_count_2 column for batches with a second dispersion stage.
-- The bulk data file layout is: Dispersion 1 Resource | Pre Mix Count | Dispersion 2 Resource | Pre Mix Count (2)
-- Each dispersion stage has its own premix count; premix_count maps to disp1 and premix_count_2 maps to disp2.
ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS premix_count_2 integer DEFAULT 0;

COMMENT ON COLUMN batches.premix_count_2 IS 'Premix count for the second dispersion stage (Dispersion 2 Resource). premix_count is for stage 1.';
