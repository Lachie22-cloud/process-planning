export type BatchStatus =
  | "Planned"
  | "In Progress"
  | "Complete"
  | "Rework"
  | "NCB"
  | "Excess Paint"
  | "Bulk Off"
  | "OFF"
  | "WOM"
  | "WOP"
  | "On Test"
  | "Ready to Fill"
  | "Filling"
  | "Hold"
  | "Cancelled";

export type VettingStatus = "pending" | "approved" | "rejected" | "not_required";

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
}

/** Batch with eagerly loaded fill orders */
export interface BatchWithFillOrders extends Batch {
  linkedFillOrders: LinkedFillOrder[];
}

/** Statuses that require a mandatory comment */
export const COMMENT_REQUIRED_STATUSES: BatchStatus[] = [
  "Rework",
  "Bulk Off",
  "Excess Paint",
];
