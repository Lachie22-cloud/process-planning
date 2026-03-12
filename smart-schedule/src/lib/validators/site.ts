import { z } from "zod";

const VALID_TIMEZONES = new Set(Intl.supportedValuesOf("timeZone"));

/** Schema for creating / editing a site in the super-admin form */
export const siteFormSchema = z.object({
  name: z
    .string()
    .min(1, "Site name is required")
    .max(100, "Site name must be 100 characters or fewer"),
  code: z
    .string()
    .min(1, "Site code is required")
    .max(20, "Site code must be 20 characters or fewer")
    .regex(/^[A-Z0-9_-]+$/, "Only uppercase letters, numbers, hyphens, and underscores"),
  timezone: z
    .string()
    .min(1, "Timezone is required")
    .refine((v) => VALID_TIMEZONES.has(v), "Please select a valid IANA timezone"),
  weekEndDay: z.coerce.number().int().min(0).max(6).default(5),
  scheduleHorizon: z.coerce.number().int().min(1).max(30).default(7),
  active: z.boolean().default(true),
});

export type SiteFormInput = z.infer<typeof siteFormSchema>;
