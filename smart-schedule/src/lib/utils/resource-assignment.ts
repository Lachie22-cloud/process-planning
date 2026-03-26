import type { Resource } from "@/types/resource";
import type { ImportBatch } from "@/hooks/use-import";

/**
 * Assigns a batch to the best-fit resource based on:
 * 1. Resource must be active
 * 2. Batch volume must fit within resource capacity (min/max)
 * 3. Pack size determines resource type (larger = mixer, smaller = disperser)
 * 4. Prefer resources in the same group (if determinable)
 *
 * Returns the resource ID or null if no suitable resource found.
 */
export function assignBatchToResource(
  batch: ImportBatch,
  resources: Resource[],
): string | null {
  const activeResources = resources.filter((r) => r.active);
  if (activeResources.length === 0) return null;

  // Determine expected resource type from pack size
  const resourceType = deriveResourceType(batch.packSize, batch.batchVolume);

  // Score each resource for this batch
  const scored = activeResources
    .map((r) => ({ resource: r, score: scoreResource(r, batch, resourceType) }))
    .filter((s) => s.score > 0) // score <= 0 means ineligible
    .sort((a, b) => b.score - a.score);

  return scored[0]?.resource.id ?? null;
}

/**
 * Assigns resources to a list of batches, distributing load across resources.
 * Tracks how many batches are assigned to each resource per day to respect
 * capacity limits.
 *
 * When a resource has a `groupCapacity` set, the group-level daily limit
 * overrules the individual `maxBatchesPerDay` for all resources sharing
 * the same `groupName`.
 */
export function assignBatchesToResources(
  batches: ImportBatch[],
  resources: Resource[],
): Map<string, string> {
  // Track assignments: resourceId -> date -> count
  const dailyCounts = new Map<string, Map<string, number>>();
  const assignments = new Map<string, string>(); // sapOrder -> resourceId

  const activeResources = resources.filter((r) => r.active);

  // Build group membership: groupName -> resourceIds[]
  const groupMembers = new Map<string, string[]>();
  for (const r of activeResources) {
    if (r.groupName) {
      const members = groupMembers.get(r.groupName) ?? [];
      members.push(r.id);
      groupMembers.set(r.groupName, members);
    }
  }

  // Resolve the effective group capacity for a group (take the first non-null value)
  const groupCapacityCache = new Map<string, number | null>();
  function getGroupCapacity(groupName: string): number | null {
    if (groupCapacityCache.has(groupName)) return groupCapacityCache.get(groupName)!;
    const cap = activeResources
      .find((r) => r.groupName === groupName && r.groupCapacity != null)
      ?.groupCapacity ?? null;
    groupCapacityCache.set(groupName, cap);
    return cap;
  }

  // Sum daily counts across all resources in a group for a given date
  function getGroupDayCount(groupName: string, date: string): number {
    const members = groupMembers.get(groupName) ?? [];
    let total = 0;
    for (const memberId of members) {
      total += dailyCounts.get(memberId)?.get(date) ?? 0;
    }
    return total;
  }

  for (const batch of batches) {
    const resourceType = deriveResourceType(batch.packSize, batch.batchVolume);

    const scored = activeResources
      .map((r) => {
        let score = scoreResource(r, batch, resourceType);
        if (score <= 0) return { resource: r, score: 0 };

        if (batch.planDate) {
          const dayCount = dailyCounts.get(r.id)?.get(batch.planDate) ?? 0;

          // If this resource belongs to a group with a group_capacity set,
          // the group capacity overrules individual maxBatchesPerDay.
          if (r.groupName && getGroupCapacity(r.groupName) != null) {
            const groupCap = getGroupCapacity(r.groupName)!;
            const groupCount = getGroupDayCount(r.groupName, batch.planDate);
            if (groupCount >= groupCap) {
              score = 0; // Group is full for this day
            } else {
              score -= groupCount * 2;
            }
          } else {
            // No group capacity — fall back to per-resource limit
            if (dayCount >= r.maxBatchesPerDay) {
              score = 0; // Full for this day
            } else {
              score -= dayCount * 2;
            }
          }
        }

        return { resource: r, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (best) {
      assignments.set(batch.sapOrder, best.resource.id);

      // Update daily count
      if (batch.planDate) {
        if (!dailyCounts.has(best.resource.id)) {
          dailyCounts.set(best.resource.id, new Map());
        }
        const dayMap = dailyCounts.get(best.resource.id)!;
        dayMap.set(batch.planDate, (dayMap.get(batch.planDate) ?? 0) + 1);
      }
    }
  }

  return assignments;
}

/**
 * Derive resource type from pack size.
 * Large volumes (>= 200L or pack sizes like 200L, 500L, 1000L) → mixer
 * Medium/small volumes → disperser
 * If unknown, returns null (accept any type).
 */
function deriveResourceType(
  packSize: string | null,
  batchVolume: number | null,
): "mixer" | "disperser" | null {
  if (packSize) {
    const numMatch = packSize.match(/^(\d+(?:\.\d+)?)/);
    if (numMatch) {
      const litres = parseFloat(numMatch[1]!);
      if (litres >= 200) return "mixer";
      if (litres <= 20) return "disperser";
    }
  }

  if (batchVolume != null) {
    if (batchVolume >= 500) return "mixer";
    if (batchVolume <= 100) return "disperser";
  }

  return null;
}

/**
 * Score a resource for a batch. Higher = better fit.
 * Returns 0 or negative if the resource is ineligible.
 */
function scoreResource(
  resource: Resource,
  batch: ImportBatch,
  expectedType: "mixer" | "disperser" | null,
): number {
  let score = 10; // Base score

  // Type match
  if (expectedType) {
    if (resource.resourceType !== expectedType) return 0;
    score += 5;
  }

  // Capacity check
  if (batch.batchVolume != null) {
    if (resource.minCapacity != null && batch.batchVolume < resource.minCapacity) {
      return 0; // Under capacity
    }
    if (resource.maxCapacity != null && batch.batchVolume > resource.maxCapacity) {
      return 0; // Over capacity
    }

    // Prefer resources where batch volume fits well (closer to max = better utilisation)
    if (resource.maxCapacity != null && resource.maxCapacity > 0) {
      const utilisation = batch.batchVolume / resource.maxCapacity;
      score += Math.round(utilisation * 10);
    }
  }

  return score;
}
