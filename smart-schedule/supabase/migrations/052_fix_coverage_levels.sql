-- 052_fix_coverage_levels.sql: Fix stale coverage levels that don't match stock_cover (days)
-- The level column should always reflect days cover thresholds:
--   Stock Out = available_stock <= 0 AND next_po_order IS NOT NULL
--   Critical  = stock_cover < 15
--   Low       = stock_cover < 30
--   Good      = stock_cover >= 30

UPDATE batch_coverage_items
SET level = CASE
  WHEN available_stock <= 0 AND next_po_order IS NOT NULL THEN 'Stock Out'
  WHEN stock_cover < 15 THEN 'Critical'
  WHEN stock_cover < 30 THEN 'Low'
  ELSE 'Good'
END
WHERE level != CASE
  WHEN available_stock <= 0 AND next_po_order IS NOT NULL THEN 'Stock Out'
  WHEN stock_cover < 15 THEN 'Critical'
  WHEN stock_cover < 30 THEN 'Low'
  ELSE 'Good'
END;
