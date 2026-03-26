export type MaterialType = "RM" | "PKG";

export interface MaterialShortage {
  id: string;
  siteId: string;
  materialCode: string;
  materialDesc: string | null;
  materialType: MaterialType;
  requiredQty: number;
  sohQty: number;
  shortQty: number;
  uom: string;
  eta: string | null;
  plannerOverride: boolean;
  overrideBy: string | null;
  overrideAt: string | null;
  overrideComment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BatchMaterialShortage {
  id: string;
  siteId: string;
  batchId: string;
  shortageId: string;
  requiredQty: number;
  shortQty: number;
  plannerOverride: boolean;
  overrideBy: string | null;
  overrideAt: string | null;
  overrideComment: string | null;
  createdAt: string;
}
