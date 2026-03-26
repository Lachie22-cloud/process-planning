-- Add group_capacity column to resources for disperser group-level PMC limits
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'resources' AND column_name = 'group_capacity'
  ) THEN
    ALTER TABLE resources ADD COLUMN group_capacity INTEGER;
    COMMENT ON COLUMN resources.group_capacity IS
      'Max combined premixes per day for all resources sharing the same group_name. Applies to dispersers.';
  END IF;
END $$;
