import { z } from "zod";

export const bulkAlertFormSchema = z
  .object({
    message: z.string().trim().min(1, "Message is required").max(500),
    bulkCode: z
      .string()
      .trim()
      .max(64)
      .optional()
      .nullable()
      .transform((v) => v || null),
    batchId: z
      .string()
      .uuid("Batch ID must be a valid UUID")
      .optional()
      .nullable()
      .transform((v) => v || null),
    startDate: z
      .string()
      .optional()
      .nullable()
      .transform((v) => v || null),
    endDate: z
      .string()
      .optional()
      .nullable()
      .transform((v) => v || null),
  })
  .superRefine((input, ctx) => {
    if (input.startDate && input.endDate && input.endDate < input.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "End date must be on or after start date",
      });
    }
  });

export type BulkAlertFormInput = z.infer<typeof bulkAlertFormSchema>;
