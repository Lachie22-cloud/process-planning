export type ResourceType = "mixer" | "disperser" | "pot";

export interface Resource {
  id: string;
  siteId: string;
  resourceCode: string;
  resourceType: ResourceType;
  displayName: string | null;
  trunkLine: string | null;
  groupName: string | null;
  minCapacity: number | null;
  maxCapacity: number | null;
  maxBatchesPerDay: number;
  chemicalBase: string | null;
  sortOrder: number;
  active: boolean;
  config: Record<string, unknown>;
  createdAt: string;
}
