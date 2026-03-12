import { z } from "zod";

export const resourceTypeSchema = z.enum(["mixer", "disperser", "pot"]);

/** Schema for creating / editing a resource in the admin form */
export const resourceFormSchema = z
  .object({
    resourceCode: z
      .string()
      .min(1, "Resource code is required")
      .max(20, "Resource code must be 20 characters or fewer")
      .regex(/^[A-Za-z0-9_-]+$/, "Only letters, numbers, hyphens, and underscores"),
    resourceType: resourceTypeSchema,
    displayName: z.string().max(100).nullable().default(null),
    trunkLine: z.string().max(50).nullable().default(null),
    groupName: z.string().max(50).nullable().default(null),
    minCapacity: z.coerce.number().int().min(0).nullable().default(null),
    maxCapacity: z.coerce.number().int().min(0).nullable().default(null),
    maxBatchesPerDay: z.coerce.number().int().min(1, "Must be at least 1").default(1),
    chemicalBase: z.string().max(50).nullable().default(null),
    sortOrder: z.coerce.number().int().min(0).default(0),
    active: z.boolean().default(true),
  })
  .refine(
    (data) => {
      if (data.minCapacity != null && data.maxCapacity != null) {
        return data.minCapacity <= data.maxCapacity;
      }
      return true;
    },
    {
      message: "Min capacity must be less than or equal to max capacity",
      path: ["minCapacity"],
    },
  );

export type ResourceFormInput = z.infer<typeof resourceFormSchema>;
