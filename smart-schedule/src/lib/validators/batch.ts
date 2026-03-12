import { z } from "zod";

export const batchStatusSchema = z.enum([
  "unscheduled",
  "scheduled",
  "in_progress",
  "qc_hold",
  "qc_pass",
  "completed",
  "on_hold",
  "cancelled",
]);

export const batchSchema = z.object({
  id: z.string().uuid(),
  siteId: z.string().uuid(),
  batchNumber: z.string().min(1),
  productCode: z.string().min(1),
  productName: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().min(1),
  status: batchStatusSchema,
  priority: z.number().int().min(0).max(99),
  colorGroup: z.string().nullable(),
  scheduledDate: z.string().nullable(),
  resourceId: z.string().uuid().nullable(),
  qcStage: z.string().nullable(),
  notes: z.string().nullable(),
});

export type BatchInput = z.infer<typeof batchSchema>;
