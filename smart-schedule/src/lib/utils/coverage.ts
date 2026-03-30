import type { CoverageLevel } from "@/types/batch";

/**
 * Single source of truth for coverage level classification.
 * Uses days cover (stockCover) from ZP40 to determine Critical / Low / Good.
 * Stock Out requires both zero available stock AND a fill order (NextPO).
 */
export function classifyCoverageLevel(
  availableStock: number,
  stockCover: number,
  nextPoOrder?: string | null,
): CoverageLevel {
  if (availableStock <= 0 && nextPoOrder) return "Stock Out";
  if (stockCover < 15) return "Critical";
  if (stockCover < 30) return "Low";
  return "Good";
}
