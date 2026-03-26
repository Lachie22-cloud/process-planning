-- Add components column to linked_fill_orders to store BOM material codes
-- (e.g. ANOPR15X for red lids, LOPBOCAPF for blue lids)
ALTER TABLE linked_fill_orders
  ADD COLUMN IF NOT EXISTS components TEXT[] DEFAULT '{}';
