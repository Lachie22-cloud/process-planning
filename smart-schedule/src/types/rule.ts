export interface SubstitutionRule {
  id: string;
  siteId: string;
  sourceResourceId: string | null;
  targetResourceId: string | null;
  conditions: SubstitutionConditions | null;
  enabled: boolean;
  createdBy: string | null;
  createdAt: string;
}

export interface SubstitutionConditions {
  maxVolume?: number;
  minVolume?: number;
  colorGroups?: string[];
}

export interface ScheduleRule {
  id: string;
  siteId: string;
  name: string;
  description: string | null;
  ruleType: "schedule" | "bulk" | null;
  conditions: Record<string, unknown> | null;
  actions: Record<string, unknown> | null;
  ruleVersion: number;
  schemaId: string;
  enabled: boolean;
  createdBy: string | null;
  createdAt: string;
}
