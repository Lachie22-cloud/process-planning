export interface BulkAlert {
  id: string;
  siteId: string;
  batchId: string | null;
  bulkCode: string | null;
  message: string;
  startDate: string | null;
  endDate: string | null;
  createdBy: string | null;
  createdAt: string;
}
