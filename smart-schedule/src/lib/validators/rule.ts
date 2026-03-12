import { z } from "zod";

/* ---------- shared ---------- */

const RULE_TYPE_ENUM = ["schedule", "bulk"] as const;
const SCHEMA_VERSION_GUARD = 1;

/** Validates that a string parses as a JSON object */
const jsonObjectString = z
  .string()
  .refine(
    (val) => {
      if (!val.trim()) return true; // allow empty → treated as null
      try {
        const parsed = JSON.parse(val);
        return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
      } catch {
        return false;
      }
    },
    { message: "Must be a valid JSON object (e.g. {})" },
  );

/* ---------- schedule rule form ---------- */

export const scheduleRuleFormSchema = z.object({
  name: z.string().trim().min(1, "Rule name is required").max(200, "Rule name must be 200 characters or fewer"),
  description: z.string().max(1000).nullable().default(null),
  ruleType: z.enum(RULE_TYPE_ENUM, {
    errorMap: () => ({ message: `Rule type must be one of: ${RULE_TYPE_ENUM.join(", ")}` }),
  }),
  conditionsText: jsonObjectString.default("{}"),
  actionsText: jsonObjectString.default("{}"),
  enabled: z.boolean().default(true),
  ruleVersion: z.coerce
    .number()
    .int()
    .min(1)
    .max(SCHEMA_VERSION_GUARD, `Schema version must not exceed ${SCHEMA_VERSION_GUARD}`)
    .default(SCHEMA_VERSION_GUARD),
});

export type ScheduleRuleFormInput = z.infer<typeof scheduleRuleFormSchema>;

/* ---------- substitution rule form ---------- */

export const substitutionConditionsSchema = z.object({
  maxVolume: z.coerce.number().min(0, "Max volume must be non-negative").optional(),
  minVolume: z.coerce.number().min(0, "Min volume must be non-negative").optional(),
  colorGroups: z.array(z.string().min(1)).optional(),
});

export const substitutionRuleFormSchema = z
  .object({
    sourceResourceId: z.string().uuid("Select a source resource").nullable(),
    targetResourceId: z.string().uuid("Select a target resource").nullable(),
    conditions: substitutionConditionsSchema.nullable().default(null),
    enabled: z.boolean().default(true),
  })
  .refine(
    (data) => data.sourceResourceId || data.targetResourceId,
    { message: "At least one of source or target resource must be selected", path: ["sourceResourceId"] },
  )
  .refine(
    (data) => {
      if (data.sourceResourceId && data.targetResourceId) {
        return data.sourceResourceId !== data.targetResourceId;
      }
      return true;
    },
    { message: "Source and target resource must be different", path: ["targetResourceId"] },
  )
  .refine(
    (data) => {
      if (data.conditions?.minVolume != null && data.conditions?.maxVolume != null) {
        return data.conditions.minVolume <= data.conditions.maxVolume;
      }
      return true;
    },
    { message: "Min volume must be less than or equal to max volume", path: ["conditions"] },
  );

export type SubstitutionRuleFormInput = z.infer<typeof substitutionRuleFormSchema>;

/* ---------- helpers ---------- */

/** Parse a JSON text field into a Record or return null */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "{}") return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
