export type BatchStatus =
  | "Planned"
  | "In Progress"
  | "In Lab"
  | "On Test"
  | "Ready to Fill"
  | "Filling"
  | "Job Complete"
  | "NCB"
  | "OFF Rework"
  | "OFF WOM"
  | "OFF WOP"
  | "Hold";

export type VettingStatus = "pending" | "approved" | "rejected" | "not_required";

/** Status group classification */
export type StatusGroup = "production" | "variable";

/** Production statuses in linear flow order */
export const PRODUCTION_STATUSES: BatchStatus[] = [
  "Planned",
  "In Progress",
  "In Lab",
  "On Test",
  "Ready to Fill",
  "Filling",
  "Job Complete",
];

/** Variable statuses (hold/off/quality) — top-level items shown in dropdown */
export const VARIABLE_STATUSES: BatchStatus[] = [
  "NCB",
  "OFF Rework",
  "OFF WOM",
  "OFF WOP",
  "Hold",
];

/** Variable statuses excluding OFF sub-types (shown at top level in dropdown) */
export const VARIABLE_TOP_LEVEL: BatchStatus[] = ["NCB", "Hold"];

/** OFF sub-statuses (shown after selecting OFF parent) */
export const OFF_STATUSES: BatchStatus[] = ["OFF Rework", "OFF WOM", "OFF WOP"];

/** Labels for OFF sub-options shown in the drill-down */
export const OFF_SUB_LABELS: Record<string, string> = {
  "OFF Rework": "Rework",
  "OFF WOM": "WOM — Material shortage",
  "OFF WOP": "WOP — Packaging shortage",
};

/** Statuses that require a mandatory comment */
export const COMMENT_REQUIRED_STATUSES: BatchStatus[] = [
  "NCB",
  "OFF Rework",
  "OFF WOM",
  "OFF WOP",
  "Hold",
];

/** Statuses that have an optional comment prompt */
export const OPTIONAL_COMMENT_STATUSES: BatchStatus[] = [
  "Job Complete",
];

export interface Batch {
  id: string;
  siteId: string;
  sapOrder: string;
  materialCode: string | null;
  materialDescription: string | null;
  bulkCode: string | null;
  planDate: string | null;
  planResourceId: string | null;
  planDisperserId: string | null;
  planDisperser2Id: string | null;
  batchVolume: number | null;
  status: BatchStatus;
  sapColorGroup: string | null;
  packSize: string | null;
  rmAvailable: boolean;
  packagingAvailable: boolean;
  qcObservedStage: string | null;
  qcObservedAt: string | null;
  qcObservedBy: string | null;
  jobLocation: string | null;
  statusComment: string | null;
  statusChangedAt: string | null;
  statusChangedBy: string | null;
  excessPaintComment: string | null;
  bulkOffComment: string | null;
  stockCover: number | null;
  safetyStock: number | null;
  poDate: string | null;
  poQuantity: number | null;
  forecast: number | null;
  materialShortage: boolean;
  vettingStatus: VettingStatus;
  vettedBy: string | null;
  vettedAt: string | null;
  vettingComment: string | null;
  bulkBatchNumber: string | null;
  premixCount: number;
  premixCount2: number;
  ipt: number | null;
  fillRequirement: string | null;
  observationRequired: boolean;
  ebrBatch: boolean;
  observationComment: string | null;
  ebrComment: string | null;
  physicalLocation: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LinkedFillOrder {
  id: string;
  batchId: string;
  siteId: string;
  fillOrder: string | null;
  fillMaterial: string | null;
  fillDescription: string | null;
  packSize: string | null;
  quantity: number | null;
  unit: string | null;
  lidType: string | null;
  components: string[];
}

/** Batch with eagerly loaded fill orders */
export interface BatchWithFillOrders extends Batch {
  linkedFillOrders: LinkedFillOrder[];
}

export type CoverageLevel = "Stock Out" | "Critical" | "Low" | "Good";

/** Per-plant ZP40 coverage row for a batch */
export interface BatchCoverageItem {
  id: string;
  batchId: string;
  planningMaterial: string;
  material: string | null;
  description: string | null;
  plant: string | null;
  availableStock: number;
  stockCover: number;
  safetyStock: number;
  forecastM0: number;
  poDate: string | null;
  poQuantity: number;
  level: CoverageLevel;
  nextPoOrder: string | null;
  oosLocked: boolean;
}
