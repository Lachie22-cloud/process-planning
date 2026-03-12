import type { BatchStatus } from "@/types/batch";

export interface StatusConfig {
  label: string;
  color: string;
  bgClass: string;
  textClass: string;
  sortOrder: number;
}

export const BATCH_STATUSES: Record<BatchStatus, StatusConfig> = {
  Planned: {
    label: "Planned",
    color: "oklch(0.623 0.214 259.13)",
    bgClass: "bg-blue-100 dark:bg-blue-950",
    textClass: "text-blue-700 dark:text-blue-300",
    sortOrder: 0,
  },
  "In Progress": {
    label: "In Progress",
    color: "oklch(0.768 0.233 130.85)",
    bgClass: "bg-emerald-100 dark:bg-emerald-950",
    textClass: "text-emerald-700 dark:text-emerald-300",
    sortOrder: 1,
  },
  Complete: {
    label: "Complete",
    color: "oklch(0.6 0.118 184.71)",
    bgClass: "bg-teal-100 dark:bg-teal-950",
    textClass: "text-teal-700 dark:text-teal-300",
    sortOrder: 2,
  },
  Rework: {
    label: "Rework",
    color: "oklch(0.646 0.222 41.12)",
    bgClass: "bg-orange-100 dark:bg-orange-950",
    textClass: "text-orange-700 dark:text-orange-300",
    sortOrder: 3,
  },
  NCB: {
    label: "NCB",
    color: "oklch(0.577 0.245 27.33)",
    bgClass: "bg-red-100 dark:bg-red-950",
    textClass: "text-red-700 dark:text-red-300",
    sortOrder: 4,
  },
  "Excess Paint": {
    label: "Excess Paint",
    color: "oklch(0.795 0.184 86.05)",
    bgClass: "bg-amber-100 dark:bg-amber-950",
    textClass: "text-amber-700 dark:text-amber-300",
    sortOrder: 5,
  },
  "Bulk Off": {
    label: "Bulk Off",
    color: "oklch(0.556 0.005 285.82)",
    bgClass: "bg-neutral-200 dark:bg-neutral-800",
    textClass: "text-neutral-700 dark:text-neutral-300",
    sortOrder: 6,
  },
  OFF: {
    label: "OFF",
    color: "oklch(0.556 0.005 285.82)",
    bgClass: "bg-neutral-200 dark:bg-neutral-800",
    textClass: "text-neutral-600 dark:text-neutral-400",
    sortOrder: 7,
  },
  WOM: {
    label: "WOM",
    color: "oklch(0.646 0.222 41.12)",
    bgClass: "bg-orange-100 dark:bg-orange-950",
    textClass: "text-orange-700 dark:text-orange-300",
    sortOrder: 8,
  },
  WOP: {
    label: "WOP",
    color: "oklch(0.795 0.184 86.05)",
    bgClass: "bg-amber-100 dark:bg-amber-950",
    textClass: "text-amber-700 dark:text-amber-300",
    sortOrder: 9,
  },
  "On Test": {
    label: "On Test",
    color: "oklch(0.627 0.265 303.9)",
    bgClass: "bg-purple-100 dark:bg-purple-950",
    textClass: "text-purple-700 dark:text-purple-300",
    sortOrder: 10,
  },
  "Ready to Fill": {
    label: "Ready to Fill",
    color: "oklch(0.696 0.17 162.48)",
    bgClass: "bg-cyan-100 dark:bg-cyan-950",
    textClass: "text-cyan-700 dark:text-cyan-300",
    sortOrder: 11,
  },
  Filling: {
    label: "Filling",
    color: "oklch(0.768 0.233 130.85)",
    bgClass: "bg-green-100 dark:bg-green-950",
    textClass: "text-green-700 dark:text-green-300",
    sortOrder: 12,
  },
  Hold: {
    label: "Hold",
    color: "oklch(0.646 0.222 41.12)",
    bgClass: "bg-orange-100 dark:bg-orange-950",
    textClass: "text-orange-700 dark:text-orange-300",
    sortOrder: 13,
  },
  Cancelled: {
    label: "Cancelled",
    color: "oklch(0.577 0.245 27.33)",
    bgClass: "bg-red-100 dark:bg-red-950",
    textClass: "text-red-700 dark:text-red-300",
    sortOrder: 14,
  },
};

/** All status values in display order */
export const BATCH_STATUS_LIST = Object.entries(BATCH_STATUSES)
  .sort(([, a], [, b]) => a.sortOrder - b.sortOrder)
  .map(([key]) => key as BatchStatus);
