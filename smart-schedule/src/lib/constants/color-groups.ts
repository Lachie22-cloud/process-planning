export interface ColorGroupConfig {
  name: string;
  order: number;
  color: string;
}

export const COLOR_GROUPS: Record<string, ColorGroupConfig> = {
  CGCLR: { name: "CLEAR", order: 0, color: "#e5e7eb" },
  CGWHI: { name: "WHITE", order: 1, color: "#f8f9fa" },
  CGBRN: { name: "WARM", order: 2, color: "#d4a574" },
  CGYEL: { name: "YELLOW", order: 3, color: "#ffd700" },
  CGRED: { name: "RED", order: 4, color: "#dc2626" },
  CGGRN: { name: "GREEN", order: 5, color: "#16a34a" },
  CGBLU: { name: "BLUE", order: 6, color: "#2563eb" },
  CGBLK: { name: "BLACK", order: 7, color: "#1f2937" },
  CGOTH: { name: "OTHER", order: 8, color: "#9ca3af" },
};
