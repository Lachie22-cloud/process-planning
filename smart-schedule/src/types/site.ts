export interface Site {
  id: string;
  name: string;
  code: string;
  timezone: string;
  weekEndDay: number;
  scheduleHorizon: number;
  config: Record<string, unknown>;
  active: boolean;
  createdAt: string;
}

export interface ResourceBlock {
  id: string;
  siteId: string;
  resourceId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
}
