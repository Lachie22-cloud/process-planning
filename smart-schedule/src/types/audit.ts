export interface AuditEntry {
  id: string;
  siteId: string;
  batchId: string | null;
  action: string;
  details: Record<string, unknown> | null;
  performedBy: string | null;
  performedAt: string;
}

export interface ScheduleMovement {
  id: string;
  siteId: string;
  batchId: string | null;
  fromResourceId: string | null;
  toResourceId: string | null;
  fromDate: string | null;
  toDate: string | null;
  direction: "pulled" | "pushed" | "moved" | null;
  reason: string | null;
  movedBy: string | null;
  movedAt: string;
}
