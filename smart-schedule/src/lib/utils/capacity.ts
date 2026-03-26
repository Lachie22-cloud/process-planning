import type { Resource } from "@/types/resource";
import type { Batch } from "@/types/batch";

/**
 * Return the effective daily limit for a resource.
 * When the resource belongs to a group with groupCapacity set, that value
 * overrules the individual maxBatchesPerDay.
 */
export function getEffectiveLimit(
  resource: Resource,
  _allResources?: Resource[],
): number {
  if (resource.groupName != null && resource.groupCapacity != null) {
    return resource.groupCapacity;
  }
  return resource.maxBatchesPerDay;
}

/**
 * Count the batches that count toward this resource's daily limit.
 * For group-capacity resources this is the total across all group members.
 */
function getEffectiveCount(
  resource: Resource,
  batches: Batch[],
  allResources?: Resource[],
): number {
  if (resource.groupName != null && resource.groupCapacity != null && allResources) {
    const groupIds = new Set(
      allResources
        .filter((r) => r.groupName === resource.groupName && r.active)
        .map((r) => r.id),
    );
    return batches.filter((b) => b.planResourceId != null && groupIds.has(b.planResourceId)).length;
  }
  return batches.filter((b) => b.planResourceId === resource.id).length;
}

export function calculateUtilization(
  resource: Resource,
  batches: Batch[],
  allResources?: Resource[],
): number {
  const limit = getEffectiveLimit(resource, allResources);
  if (limit === 0) return 0;
  const count = getEffectiveCount(resource, batches, allResources);
  return Math.round((count / limit) * 100);
}

export function isOverCapacity(
  resource: Resource,
  batches: Batch[],
  allResources?: Resource[],
): boolean {
  const limit = getEffectiveLimit(resource, allResources);
  const count = getEffectiveCount(resource, batches, allResources);
  return count > limit;
}
