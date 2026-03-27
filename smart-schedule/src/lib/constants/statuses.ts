import type { BatchStatus } from "@/types/batch";
import { PRODUCTION_STATUSES, VARIABLE_STATUSES } from "@/types/batch";

export interface StatusConfig {
  label: string;
  color: string;
  bgClass: string;
  textClass: string;
  sortOrder: number;
  /** Group label shown in dropdown separator */
  group: "production" | "variable";
}

export const BATCH_STATUSES: Record<BatchStatus, StatusConfig> = {
  // ── Production flow ────────────────────────────
  Planned: {
    label: "Planned",
    color: "oklch(0.623 0.214 259.13)",
    bgClass: "bg-blue-100 dark:bg-blue-950",
    textClass: "text-blue-700 dark:text-blue-300",
    sortOrder: 0,
    group: "production",
  },
  "In Progress": {
    label: "In Progress",
    color: "oklch(0.768 0.233 130.85)",
    bgClass: "bg-emerald-100 dark:bg-emerald-950",
    textClass: "text-emerald-700 dark:text-emerald-300",
    sortOrder: 1,
    group: "production",
  },
  "In Lab": {
    label: "In Lab",
    color: "oklch(0.627 0.265 303.9)",
    bgClass: "bg-purple-100 dark:bg-purple-950",
    textClass: "text-purple-700 dark:text-purple-300",
    sortOrder: 2,
    group: "production",
  },
  "On Test": {
    label: "On Test",
    color: "oklch(0.627 0.265 303.9)",
    bgClass: "bg-violet-100 dark:bg-violet-950",
    textClass: "text-violet-700 dark:text-violet-300",
    sortOrder: 3,
    group: "production",
  },
  "Ready to Fill": {
    label: "Ready to Fill",
    color: "oklch(0.696 0.17 162.48)",
    bgClass: "bg-cyan-100 dark:bg-cyan-950",
    textClass: "text-cyan-700 dark:text-cyan-300",
    sortOrder: 4,
    group: "production",
  },
  Filling: {
    label: "Filling",
    color: "oklch(0.768 0.233 130.85)",
    bgClass: "bg-green-100 dark:bg-green-950",
    textClass: "text-green-700 dark:text-green-300",
    sortOrder: 5,
    group: "production",
  },
  "Job Complete": {
    label: "Job Complete",
    color: "oklch(0.6 0.118 184.71)",
    bgClass: "bg-teal-100 dark:bg-teal-950",
    textClass: "text-teal-700 dark:text-teal-300",
    sortOrder: 6,
    group: "production",
  },

  // ── Variable statuses ──────────────────────────
  NCB: {
    label: "NCB",
    color: "oklch(0.577 0.245 27.33)",
    bgClass: "bg-red-100 dark:bg-red-950",
    textClass: "text-red-700 dark:text-red-300",
    sortOrder: 7,
    group: "variable",
  },
  "OFF Rework": {
    label: "OFF Rework",
    color: "oklch(0.646 0.222 41.12)",
    bgClass: "bg-orange-100 dark:bg-orange-950",
    textClass: "text-orange-700 dark:text-orange-300",
    sortOrder: 8,
    group: "variable",
  },
  "OFF WOM": {
    label: "OFF WOM",
    color: "oklch(0.646 0.222 41.12)",
    bgClass: "bg-orange-100 dark:bg-orange-950",
    textClass: "text-orange-700 dark:text-orange-300",
    sortOrder: 9,
    group: "variable",
  },
  "OFF WOP": {
    label: "OFF WOP",
    color: "oklch(0.795 0.184 86.05)",
    bgClass: "bg-amber-100 dark:bg-amber-950",
    textClass: "text-amber-700 dark:text-amber-300",
    sortOrder: 10,
    group: "variable",
  },
  Hold: {
    label: "Hold",
    color: "oklch(0.646 0.222 41.12)",
    bgClass: "bg-orange-100 dark:bg-orange-950",
    textClass: "text-orange-700 dark:text-orange-300",
    sortOrder: 11,
    group: "variable",
  },
};

/** Production statuses in flow order */
export const PRODUCTION_STATUS_LIST = PRODUCTION_STATUSES;

/** Variable statuses in display order */
export const VARIABLE_STATUS_LIST = VARIABLE_STATUSES;

/** All status values in display order */
export const BATCH_STATUS_LIST = Object.entries(BATCH_STATUSES)
  .sort(([, a], [, b]) => a.sortOrder - b.sortOrder)
  .map(([key]) => key as BatchStatus);
