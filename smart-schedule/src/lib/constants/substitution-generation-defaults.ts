import type { SubstitutionGenerationConfig } from "../validators/substitution-generation-settings";

/**
 * Default substitution generation config seeded for new sites.
 * Same shape as the JSONB `config` column in `substitution_generation_settings`.
 *
 * - Same-group only (cross-group/trunk-line/chemical-base off)
 * - Large→small uses maxVolume, small→large uses minVolume
 * - Excludes inactive and incomplete resources
 * - Skips duplicates; preview mode on by default
 */
export const DEFAULT_GENERATION_CONFIG: SubstitutionGenerationConfig = {
  scope: {
    sameGroup: true,
    crossGroup: false,
    crossTrunkLine: false,
    crossChemicalBase: false,
  },
  capacityStrategy: {
    sameCapacityTemplate: null,
    largeToSmallTemplate: "maxVolume",
    smallToLargeTemplate: "minVolume",
    applyBothMinMax: false,
  },
  resourceEligibility: {
    includeInactive: false,
    excludeMissingFields: true,
    groupByKey: "group",
  },
  safety: {
    duplicatePolicy: "skip",
    disabledCountAsDuplicates: false,
    previewModeDefault: true,
  },
  conditionTemplates: {
    minVolume: true,
    maxVolume: true,
    colourGroups: false,
  },
} as const;

/** Current schema version for generation settings config */
export const GENERATION_SETTINGS_VERSION = 1;
