-- Move SB Pot resources to sort between Mixer 1 (sort_order 31) and Mixer 2 (sort_order 40)
-- Previously at sort_order 100-102, now at 32-34
UPDATE resources
SET sort_order = CASE resource_code
  WHEN 'SBPOT1' THEN 32
  WHEN 'SBPOT2' THEN 33
  WHEN 'SBPOT3' THEN 34
END
WHERE resource_code IN ('SBPOT1', 'SBPOT2', 'SBPOT3');
