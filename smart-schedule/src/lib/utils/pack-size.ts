/** Parse a pack size string like "500ml", "1L", "2.5L", "10L" into litres */
export function parsePackSizeLitres(packSize: string | null): number | null {
  if (!packSize) return null;
  const s = packSize.trim().toLowerCase();
  // Match patterns like "500ml", "0.5l", "1l", "2.5l", "10l", "20l"
  const mlMatch = s.match(/^([\d.]+)\s*ml$/);
  if (mlMatch?.[1]) return parseFloat(mlMatch[1]) / 1000;
  const lMatch = s.match(/^([\d.]+)\s*(?:l|ltr|ltrs)$/);
  if (lMatch?.[1]) return parseFloat(lMatch[1]);
  return null;
}

export const BLUE_LID_COMPONENT = "LOPBOCAPF";
export const RED_LID_COMPONENT = "ANOPR15X";

/**
 * Check whether a fill order contains a specific BOM component code.
 * Fallback chain: BOM components array → legacy lidType field → fillMaterial substring.
 */
export function fillOrderHasComponent(
  fillOrder: { components: string[]; fillMaterial: string | null; lidType: string | null },
  component: string,
): boolean {
  if (fillOrder.components.length > 0) {
    return fillOrder.components.some((c) => c.toUpperCase().includes(component));
  }

  const lidType = fillOrder.lidType?.trim().toLowerCase();
  if (component === BLUE_LID_COMPONENT && lidType === "blue") return true;
  if (component === RED_LID_COMPONENT && lidType === "red") return true;

  return fillOrder.fillMaterial?.toUpperCase().includes(component) ?? false;
}
