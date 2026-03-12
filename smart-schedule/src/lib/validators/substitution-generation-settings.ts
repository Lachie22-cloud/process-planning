import { z } from "zod";

/* ---------- scope ---------- */

export const scopeSchema = z.object({
  sameGroup: z.boolean(),
  crossGroup: z.boolean(),
  crossTrunkLine: z.boolean(),
  crossChemicalBase: z.boolean(),
});

/* ---------- capacity strategy ---------- */

/** Template identifiers for capacity-based condition generation */
export const CAPACITY_TEMPLATES = ["maxVolume", "minVolume", "both"] as const;
export type CapacityTemplate = (typeof CAPACITY_TEMPLATES)[number];

export const capacityStrategySchema = z.object({
  /** Condition template for same-capacity pairs (null = no conditions) */
  sameCapacityTemplate: z.enum(CAPACITY_TEMPLATES).nullable(),
  /** Condition template for large-to-small substitutions */
  largeToSmallTemplate: z.enum(CAPACITY_TEMPLATES).nullable(),
  /** Condition template for small-to-large substitutions */
  smallToLargeTemplate: z.enum(CAPACITY_TEMPLATES).nullable(),
  /** Apply both min and max defaults from target capacity range */
  applyBothMinMax: z.boolean(),
});

/* ---------- resource eligibility ---------- */

export const GROUP_BY_KEYS = ["group", "trunk_line", "both"] as const;
export type GroupByKey = (typeof GROUP_BY_KEYS)[number];

export const resourceEligibilitySchema = z.object({
  /** Include inactive resources in generation candidates */
  includeInactive: z.boolean(),
  /** Skip resources missing group or capacity fields */
  excludeMissingFields: z.boolean(),
  /** How to group resources for pair generation */
  groupByKey: z.enum(GROUP_BY_KEYS),
});

/* ---------- safety ---------- */

export const DUPLICATE_POLICIES = ["skip", "upsert", "create_disabled"] as const;
export type DuplicatePolicy = (typeof DUPLICATE_POLICIES)[number];

export const safetySchema = z.object({
  /** How to handle duplicate source→target pairs */
  duplicatePolicy: z.enum(DUPLICATE_POLICIES),
  /** Whether disabled existing rules count as duplicates */
  disabledCountAsDuplicates: z.boolean(),
  /** Whether the preview dialog is shown by default */
  previewModeDefault: z.boolean(),
});

/* ---------- condition templates ---------- */

export const conditionTemplatesSchema = z.object({
  /** Generate minVolume conditions from target capacity */
  minVolume: z.boolean(),
  /** Generate maxVolume conditions from target capacity */
  maxVolume: z.boolean(),
  /** Generate colourGroups conditions from resource colour data */
  colourGroups: z.boolean(),
});

/* ---------- full config ---------- */

export const substitutionGenerationConfigSchema = z.object({
  scope: scopeSchema,
  capacityStrategy: capacityStrategySchema,
  resourceEligibility: resourceEligibilitySchema,
  safety: safetySchema,
  conditionTemplates: conditionTemplatesSchema,
});

export type SubstitutionGenerationConfig = z.infer<typeof substitutionGenerationConfigSchema>;

/* ---------- settings row (mirrors DB columns) ---------- */

export const substitutionGenerationSettingsSchema = z.object({
  id: z.string().uuid(),
  site_id: z.string().uuid(),
  enabled: z.boolean(),
  config: substitutionGenerationConfigSchema,
  version: z.number().int().min(1),
  updated_by: z.string().uuid().nullable(),
  updated_at: z.string(),
  created_at: z.string(),
});

export type SubstitutionGenerationSettings = z.infer<typeof substitutionGenerationSettingsSchema>;

/* ---------- form schema (for the admin settings form) ---------- */

export const substitutionGenerationFormSchema = z.object({
  enabled: z.boolean(),
  config: substitutionGenerationConfigSchema,
});

export type SubstitutionGenerationFormInput = z.infer<typeof substitutionGenerationFormSchema>;
