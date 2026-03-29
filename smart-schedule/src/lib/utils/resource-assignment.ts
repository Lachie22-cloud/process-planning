import type { Resource } from "@/types/resource";
import type { ImportBatch } from "@/hooks/use-import";
import type { SubstitutionRule } from "@/types/rule";

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
 * Checks whether a substitution from sourceResource to targetResource is
 * allowed for a batch with the given volume and colour group.
 * Shared by import conflict resolution, placement scoring, and rule evaluation.
 */
export function isSubstitutionAllowed(
  sourceResourceId: string,
  targetResourceId: string,
  batchVolume: number | null,
  sapColorGroup: string | null,
  rules: SubstitutionRule[],
): boolean {
  return rules.some((rule) => {
    if (!rule.enabled) return false;

    // Match source (null = wildcard)
    if (rule.sourceResourceId !== null && rule.sourceResourceId !== sourceResourceId) {
      return false;
    }
    // Match target (null = wildcard)
    if (rule.targetResourceId !== null && rule.targetResourceId !== targetResourceId) {
      return false;
    }
    // Volume conditions
    if (rule.conditions && batchVolume != null) {
      if (rule.conditions.maxVolume != null && batchVolume > rule.conditions.maxVolume) {
        return false;
      }
      if (rule.conditions.minVolume != null && batchVolume < rule.conditions.minVolume) {
        return false;
      }
    }
    // Colour group conditions
    if (
      rule.conditions?.colorGroups &&
      rule.conditions.colorGroups.length > 0 &&
      sapColorGroup
    ) {
      if (!rule.conditions.colorGroups.includes(sapColorGroup)) {
        return false;
      }
    }
    return true;
  });
}

/**
 * After SAP-based resource assignment, detects over-capacity (resource, date)
 * cells and attempts to move excess batches to substitute resources on the
 * **same date** using enabled substitution rules.
 *
 * Returns:
 * - resolved: Map of sapOrder → new resourceId for batches that were moved
 * - unresolved: Set of sapOrders that remain in conflict (no valid substitute)
 */
export function resolveConflictsWithSubstitutions(
  assignments: Map<string, string>,
  batches: ImportBatch[],
  resources: Resource[],
  substitutionRules: SubstitutionRule[],
): { resolved: Map<string, string>; unresolved: Set<string> } {
  const resolved = new Map<string, string>();
  const unresolved = new Set<string>();

  const activeResources = resources.filter((r) => r.active);
  const resourceMap = new Map(activeResources.map((r) => [r.id, r]));
  const batchMap = new Map(batches.map((b) => [b.sapOrder, b]));

  // Build group membership: groupName → resourceIds[]
  const groupMembers = new Map<string, string[]>();
  for (const r of activeResources) {
    if (r.groupName) {
      const members = groupMembers.get(r.groupName) ?? [];
      members.push(r.id);
      groupMembers.set(r.groupName, members);
    }
  }

  // Build daily slots: resourceId → date → sapOrder[]
  const dailySlots = new Map<string, Map<string, string[]>>();
  for (const [sapOrder, resourceId] of assignments) {
    const batch = batchMap.get(sapOrder);
    if (!batch?.planDate) continue;
    if (!dailySlots.has(resourceId)) {
      dailySlots.set(resourceId, new Map());
    }
    const dateMap = dailySlots.get(resourceId)!;
    const orders = dateMap.get(batch.planDate) ?? [];
    orders.push(sapOrder);
    dateMap.set(batch.planDate, orders);
  }

  // Helper: count batches across a group for a date
  function getGroupDayCount(groupName: string, date: string): number {
    const members = groupMembers.get(groupName) ?? [];
    let total = 0;
    for (const memberId of members) {
      total += dailySlots.get(memberId)?.get(date)?.length ?? 0;
    }
    return total;
  }

  // Helper: check if a resource has spare capacity on a date
  function hasDailyRoom(resource: Resource, date: string): boolean {
    if (resource.groupName && resource.groupCapacity != null) {
      return getGroupDayCount(resource.groupName, date) < resource.groupCapacity;
    }
    const count = dailySlots.get(resource.id)?.get(date)?.length ?? 0;
    return count < resource.maxBatchesPerDay;
  }

  // Helper: add an order to dailySlots
  function addToSlots(resourceId: string, date: string, sapOrder: string) {
    if (!dailySlots.has(resourceId)) {
      dailySlots.set(resourceId, new Map());
    }
    const dateMap = dailySlots.get(resourceId)!;
    const orders = dateMap.get(date) ?? [];
    orders.push(sapOrder);
    dateMap.set(date, orders);
  }

  // Helper: remove an order from dailySlots
  function removeFromSlots(resourceId: string, date: string, sapOrder: string) {
    const orders = dailySlots.get(resourceId)?.get(date);
    if (!orders) return;
    const idx = orders.indexOf(sapOrder);
    if (idx !== -1) orders.splice(idx, 1);
  }

  // Process each over-capacity cell
  for (const [resourceId, dateMap] of dailySlots) {
    const resource = resourceMap.get(resourceId);
    if (!resource) continue;

    for (const [date, orderList] of dateMap) {
      // Determine effective limit
      let limit: number;
      let currentCount: number;
      if (resource.groupName && resource.groupCapacity != null) {
        limit = resource.groupCapacity;
        currentCount = getGroupDayCount(resource.groupName, date);
      } else {
        limit = resource.maxBatchesPerDay;
        currentCount = orderList.length;
      }

      if (currentCount <= limit) continue;

      // Sort excess batches by volume ascending (smaller = easier to relocate)
      const excessCount = currentCount - limit;
      const sortedOrders = [...orderList].sort((a, b) => {
        const volA = batchMap.get(a)?.batchVolume ?? 0;
        const volB = batchMap.get(b)?.batchVolume ?? 0;
        return volA - volB;
      });
      const excessOrders = sortedOrders.slice(0, excessCount);

      for (const sapOrder of excessOrders) {
        const batch = batchMap.get(sapOrder);
        if (!batch) {
          unresolved.add(sapOrder);
          continue;
        }

        // Find candidate substitute resources
        const candidates = activeResources
          .filter((r) => {
            if (r.id === resourceId) return false;
            if (r.resourceType !== resource.resourceType) return false;
            // Capacity check
            if (batch.batchVolume != null) {
              if (r.minCapacity != null && batch.batchVolume < r.minCapacity) return false;
              if (r.maxCapacity != null && batch.batchVolume > r.maxCapacity) return false;
            }
            if (!hasDailyRoom(r, date)) return false;
            if (!isSubstitutionAllowed(resourceId, r.id, batch.batchVolume, batch.sapColorGroup, substitutionRules)) return false;
            return true;
          })
          .map((r) => ({
            resource: r,
            score: scoreResource(r, batch, resource.resourceType === "mixer" ? "mixer" : "disperser"),
          }))
          .sort((a, b) => b.score - a.score);

        if (candidates.length > 0) {
          const best = candidates[0]!.resource;
          // Move batch to substitute
          assignments.set(sapOrder, best.id);
          resolved.set(sapOrder, best.id);
          removeFromSlots(resourceId, date, sapOrder);
          addToSlots(best.id, date, sapOrder);
        } else {
          unresolved.add(sapOrder);
        }
      }
    }
  }

  return { resolved, unresolved };
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
