-- Add group_capacity column to resources for disperser group-level PMC limits
ALTER TABLE resources
  ADD COLUMN group_capacity INTEGER;

COMMENT ON COLUMN resources.group_capacity IS
  'Max combined premixes per day for all resources sharing the same group_name. Applies to dispersers.';
