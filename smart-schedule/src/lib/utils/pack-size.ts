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
