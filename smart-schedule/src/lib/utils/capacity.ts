import type { Resource } from "@/types/resource";
import type { Batch } from "@/types/batch";

export function calculateUtilization(
  resource: Resource,
  batches: Batch[],
): number {
  if (resource.maxBatchesPerDay === 0) return 0;
  const assigned = batches.filter((b) => b.planResourceId === resource.id).length;
  return Math.round((assigned / resource.maxBatchesPerDay) * 100);
}

export function isOverCapacity(
  resource: Resource,
  batches: Batch[],
): boolean {
  const assigned = batches.filter((b) => b.planResourceId === resource.id).length;
  return assigned > resource.maxBatchesPerDay;
}
