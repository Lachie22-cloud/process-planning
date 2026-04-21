import type { Batch, LinkedFillOrder } from "@/types/batch";
import type { Resource } from "@/types/resource";

export interface FillingJob extends Batch {
  linkedFillOrders: LinkedFillOrder[];
  resource: Resource | null;
}

export type SortMode = "scheduled" | "active" | "finish" | "priority";

// ── Phase 2 types ──────────────────────────────────────────────────────────

export interface FillingOverride {
  id: string;
  batchId: string;
  planDate: string;
  comment: string | null;
  holdUpNote: string | null;
  sortOrder: number | null;
}

export interface DayPlanMeta {
  id: string;
  planDate: string;
  trunkLeaders: Record<string, string>;
}

export interface GhostJob {
  batchId: string;
  sapOrder: string;
  status: string;
  originalTrunkLine: string | null;
  movedToPlanDate: string | null;
}

// ── Phase 3 types ──────────────────────────────────────────────────────────

/** fillOrderId → trunkLine */
export type FoAssignments = Record<string, string>;

/** FillingJob enriched with trunk-routing context for Phase 3 display */
export interface TrunkJob extends FillingJob {
  /** Override row for this batch+date (comment, holdUpNote, sortOrder) */
  override?: FillingOverride | null;
  /** Fill orders being shown in this trunk's card */
  displayFOs?: LinkedFillOrder[];
  /** Other trunk IDs that some of this batch's FOs were routed to */
  splitTo?: string[];
  /** True when the batch's home mixer trunk ≠ this trunk (received cross-trunk) */
  isReceived?: boolean;
  /** trunk_line of the batch's assigned mixer resource */
  sourceTrunkLine?: string | null;
  /** Explicit sort position from batch_day_plan_overrides */
  sortOrder?: number | null;
}
