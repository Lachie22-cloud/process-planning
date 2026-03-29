import type { DatabaseRow } from "@/types/database";
import type { Batch, LinkedFillOrder, BatchStatus, VettingStatus, BatchCoverageItem, CoverageLevel } from "@/types/batch";
import type { Resource, ResourceType } from "@/types/resource";
import type { Site, ResourceBlock } from "@/types/site";
import type { User, UserRole, UserPreferences } from "@/types/user";
import type { BulkAlert } from "@/types/alert";
import type { AuditEntry } from "@/types/audit";
import type { Notification } from "@/types/notification";
import type { SubstitutionRule, ScheduleRule, SubstitutionConditions } from "@/types/rule";
import type { MaterialShortage, BatchMaterialShortage } from "@/types/material-shortage";

export function mapSite(row: DatabaseRow["sites"]): Site {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    timezone: row.timezone,
    weekEndDay: row.week_end_day,
    scheduleHorizon: row.schedule_horizon,
    config: (row.config ?? {}) as Record<string, unknown>,
    active: row.active,
    createdAt: row.created_at,
  };
}

export function mapUser(row: DatabaseRow["site_users"]): User {
  return {
    id: row.id,
    siteId: row.site_id,
    externalId: row.external_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role as UserRole,
    active: row.active,
    preferences: (row.preferences ?? {}) as UserPreferences,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapResource(row: DatabaseRow["resources"]): Resource {
  return {
    id: row.id,
    siteId: row.site_id,
    resourceCode: row.resource_code,
    resourceType: row.resource_type as ResourceType,
    displayName: row.display_name,
    trunkLine: row.trunk_line,
    groupName: row.group_name,
    minCapacity: row.min_capacity,
    maxCapacity: row.max_capacity,
    maxBatchesPerDay: row.max_batches_per_day,
    groupCapacity: row.group_capacity ?? ((row.config as Record<string, unknown> | null)?.groupCapacity as number | null) ?? null,
    chemicalBase: row.chemical_base,
    sortOrder: row.sort_order,
    active: row.active,
    config: (row.config ?? {}) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

export function mapBatch(row: DatabaseRow["batches"]): Batch {
  return {
    id: row.id,
    siteId: row.site_id,
    sapOrder: row.sap_order,
    materialCode: row.material_code,
    materialDescription: row.material_description,
    bulkCode: row.bulk_code,
    planDate: row.plan_date,
    planResourceId: row.plan_resource_id,
    planDisperserId: row.plan_disperser_id,
    planDisperser2Id: row.plan_disperser2_id,
    batchVolume: row.batch_volume,
    status: row.status as BatchStatus,
    sapColorGroup: row.sap_color_group,
    packSize: row.pack_size,
    rmAvailable: row.rm_available,
    packagingAvailable: row.packaging_available,
    qcObservedStage: row.qc_observed_stage,
    qcObservedAt: row.qc_observed_at,
    qcObservedBy: row.qc_observed_by,
    jobLocation: row.job_location,
    statusComment: row.status_comment,
    statusChangedAt: row.status_changed_at,
    statusChangedBy: row.status_changed_by,
    stockCover: row.stock_cover,
    safetyStock: row.safety_stock,
    poDate: row.po_date,
    poQuantity: row.po_quantity,
    forecast: row.forecast,
    materialShortage: row.material_shortage,
    vettingStatus: row.vetting_status as VettingStatus,
    vettedBy: row.vetted_by,
    vettedAt: row.vetted_at,
    vettingComment: row.vetting_comment,
    bulkBatchNumber: row.bulk_batch_number,
    premixCount: row.premix_count ?? 0,
    premixCount2: row.premix_count_2 ?? 0,
    ipt: row.ipt,
    fillRequirement: row.fill_requirement,
    observationRequired: row.observation_required ?? false,
    ebrBatch: row.ebr_batch ?? false,
    physicalLocation: row.physical_location,
    excessPaintComment: row.excess_paint_comment,
    bulkOffComment: row.bulk_off_comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapLinkedFillOrder(row: DatabaseRow["linked_fill_orders"]): LinkedFillOrder {
  return {
    id: row.id,
    batchId: row.batch_id,
    siteId: row.site_id,
    fillOrder: row.fill_order,
    fillMaterial: row.fill_material,
    fillDescription: row.fill_description,
    packSize: row.pack_size,
    quantity: row.quantity != null ? Number(row.quantity) : null,
    unit: row.unit,
    lidType: row.lid_type,
    components: row.components ?? [],
  };
}

export function mapBulkAlert(row: DatabaseRow["bulk_alerts"]): BulkAlert {
  return {
    id: row.id,
    siteId: row.site_id,
    batchId: row.batch_id,
    bulkCode: row.bulk_code,
    message: row.message,
    startDate: row.start_date,
    endDate: row.end_date,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function mapAuditEntry(row: DatabaseRow["audit_log"]): AuditEntry {
  return {
    id: row.id,
    siteId: row.site_id,
    batchId: row.batch_id,
    action: row.action,
    details: (row.details ?? null) as Record<string, unknown> | null,
    performedBy: row.performed_by,
    performedAt: row.performed_at,
  };
}

export function mapResourceBlock(row: DatabaseRow["resource_blocks"]): ResourceBlock {
  return {
    id: row.id,
    siteId: row.site_id,
    resourceId: row.resource_id,
    startDate: row.start_date,
    endDate: row.end_date,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function mapNotification(row: DatabaseRow["notifications"]): Notification {
  return {
    id: row.id,
    siteId: row.site_id,
    userId: row.user_id,
    title: row.title,
    message: row.message,
    type: row.type as Notification["type"],
    read: row.read,
    batchId: row.batch_id,
    createdAt: row.created_at,
  };
}

export function mapSubstitutionRule(row: DatabaseRow["substitution_rules"]): SubstitutionRule {
  return {
    id: row.id,
    siteId: row.site_id,
    sourceResourceId: row.source_resource_id,
    targetResourceId: row.target_resource_id,
    conditions: (row.conditions ?? null) as SubstitutionConditions | null,
    enabled: row.enabled,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function mapScheduleRule(row: DatabaseRow["schedule_rules"]): ScheduleRule {
  return {
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    description: row.description,
    ruleType: row.rule_type as ScheduleRule["ruleType"],
    conditions: (row.conditions ?? null) as Record<string, unknown> | null,
    actions: (row.actions ?? null) as Record<string, unknown> | null,
    ruleVersion: row.rule_version,
    schemaId: row.schema_id,
    enabled: row.enabled,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function mapMaterialShortage(row: DatabaseRow["material_shortages"]): MaterialShortage {
  return {
    id: row.id,
    siteId: row.site_id,
    materialCode: row.material_code,
    materialDesc: row.material_desc,
    materialType: row.material_type,
    requiredQty: row.required_qty,
    sohQty: row.soh_qty,
    shortQty: row.short_qty,
    uom: row.uom,
    eta: row.eta,
    plannerOverride: row.planner_override,
    overrideBy: row.override_by,
    overrideAt: row.override_at,
    overrideComment: row.override_comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapBatchCoverageItem(row: DatabaseRow["batch_coverage_items"]): BatchCoverageItem {
  return {
    id: row.id,
    batchId: row.batch_id,
    planningMaterial: row.planning_material,
    material: row.material,
    description: row.description,
    plant: row.plant,
    availableStock: Number(row.available_stock),
    stockCover: Number(row.stock_cover),
    safetyStock: Number(row.safety_stock),
    forecastM0: Number(row.forecast_m0),
    poDate: row.po_date,
    poQuantity: Number(row.po_quantity),
    level: row.level as CoverageLevel,
    nextPoOrder: row.next_po_order,
    oosLocked: row.oos_locked,
  };
}

export function mapBatchMaterialShortage(row: DatabaseRow["batch_material_shortages"]): BatchMaterialShortage {
  return {
    id: row.id,
    siteId: row.site_id,
    batchId: row.batch_id,
    shortageId: row.shortage_id,
    requiredQty: row.required_qty ?? 0,
    shortQty: row.short_qty,
    eta: row.eta ?? null,
    plannerOverride: row.planner_override,
    overrideBy: row.override_by,
    overrideAt: row.override_at,
    overrideComment: row.override_comment,
    createdAt: row.created_at,
  };
}
