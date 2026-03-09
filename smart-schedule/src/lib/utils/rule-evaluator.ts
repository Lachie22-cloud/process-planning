/**
 * Lightweight schedule rules evaluator for drag-and-drop validation.
 *
 * Reads enabled `schedule_rules` and `colour_transitions` to determine
 * whether a proposed batch placement is valid, rejected, or has warnings.
 * Site admins control which rules are active via the Rules settings page.
 */

import type { Batch } from "@/types/batch";
import type { Resource } from "@/types/resource";
import type { ScheduleRule } from "@/types/rule";
import type { ColourGroup, ColourTransition } from "@/hooks/use-colour-groups";

export interface EvalContext {
  batch: Batch;
  targetResource: Resource;
  targetDate: string;
  /** Batches already scheduled on targetResource + targetDate (excluding the dragged batch). */
  existingBatches: Batch[];
  /** Only enabled rules — filter before passing. */
  rules: ScheduleRule[];
  colourGroups: ColourGroup[];
  colourTransitions: ColourTransition[];
}

export interface EvalResult {
  valid: boolean;
  warnings: string[];
}

type CheckFn = (ctx: EvalContext) => { reject?: string; warn?: string } | null;

/**
 * Map of `conditions.check` values to their evaluation functions.
 * Each returns { reject } to block the drop, { warn } for a warning, or null to pass.
 */
const CHECK_HANDLERS: Record<string, CheckFn> = {
  batch_volume_lte_resource_max: (ctx) => {
    if (
      ctx.batch.batchVolume != null &&
      ctx.targetResource.maxCapacity != null &&
      ctx.batch.batchVolume > ctx.targetResource.maxCapacity
    ) {
      return { reject: `Over capacity (${ctx.targetResource.maxCapacity.toLocaleString()}L max)` };
    }
    return null;
  },

  batch_volume_gte_resource_min: (ctx) => {
    if (
      ctx.batch.batchVolume != null &&
      ctx.targetResource.minCapacity != null &&
      ctx.batch.batchVolume < ctx.targetResource.minCapacity
    ) {
      return { warn: `Under capacity (${ctx.targetResource.minCapacity.toLocaleString()}L min)` };
    }
    return null;
  },

  batch_count_lte_max: (ctx) => {
    const max = ctx.targetResource.maxBatchesPerDay;
    if (max != null && max > 0 && ctx.existingBatches.length >= max) {
      return { reject: `Max ${max} batches/day reached` };
    }
    return null;
  },

  resource_active: (ctx) => {
    if (ctx.targetResource.active === false) {
      return { reject: "Resource is inactive" };
    }
    return null;
  },

  chemical_base_match: (ctx) => {
    const resourceBase = ctx.targetResource.chemicalBase?.toLowerCase();
    if (!resourceBase) return null;

    // Infer batch chemical base from material description
    const desc = (ctx.batch.materialDescription ?? "").toUpperCase();
    let batchBase: string | null = null;

    if (/THINNER|ENAMEL|EPOXY|ALKYD|URETHANE|SOLVENT/.test(desc)) {
      batchBase = "solvent";
    } else if (/WEATHERSHIELD|WASH.?&.?WEAR|ACRYLIC|LATEX|WATER/.test(desc)) {
      batchBase = "water";
    }

    if (!batchBase) return null;
    if (batchBase === resourceBase) return null;

    return {
      reject: `Chemical base mismatch: batch is ${batchBase}, resource is ${resourceBase}`,
    };
  },

  colour_transition_allowed: (ctx) => {
    // Check colour transitions against batches already on that resource+date
    const batchColourCode = ctx.batch.sapColorGroup;
    if (!batchColourCode || ctx.colourGroups.length === 0) return null;

    const batchGroup = ctx.colourGroups.find(
      (g) => g.code === batchColourCode || g.name === batchColourCode,
    );
    if (!batchGroup) return null;

    // Check transitions from each existing batch to the dragged batch
    for (const existing of ctx.existingBatches) {
      const existingColour = existing.sapColorGroup;
      if (!existingColour) continue;

      const existingGroup = ctx.colourGroups.find(
        (g) => g.code === existingColour || g.name === existingColour,
      );
      if (!existingGroup) continue;
      if (existingGroup.id === batchGroup.id) continue;

      const transition = ctx.colourTransitions.find(
        (t) =>
          t.fromGroupId === existingGroup.id && t.toGroupId === batchGroup.id,
      );

      if (transition && !transition.allowed) {
        return { reject: `Colour transition blocked: ${existingGroup.name} → ${batchGroup.name}` };
      }
    }

    return null;
  },

  colour_sequence: (ctx) => {
    // Warn on dark-to-light transitions that would require a washout
    const batchColourCode = ctx.batch.sapColorGroup;
    if (!batchColourCode || ctx.colourGroups.length === 0) return null;

    const batchGroup = ctx.colourGroups.find(
      (g) => g.code === batchColourCode || g.name === batchColourCode,
    );
    if (!batchGroup) return null;

    for (const existing of ctx.existingBatches) {
      const existingColour = existing.sapColorGroup;
      if (!existingColour) continue;

      const existingGroup = ctx.colourGroups.find(
        (g) => g.code === existingColour || g.name === existingColour,
      );
      if (!existingGroup) continue;
      if (existingGroup.id === batchGroup.id) continue;

      const transition = ctx.colourTransitions.find(
        (t) =>
          t.fromGroupId === existingGroup.id && t.toGroupId === batchGroup.id,
      );

      if (transition?.requiresWashout) {
        return { warn: `Washout required: ${existingGroup.name} → ${batchGroup.name}` };
      }
    }

    return null;
  },
};

/**
 * Evaluates all enabled schedule rules against a proposed batch drop.
 * Returns `{ valid: false }` if any rule rejects, or `{ valid: true, warnings }` otherwise.
 */
export function evaluateDropTarget(ctx: EvalContext): EvalResult {
  const warnings: string[] = [];

  for (const rule of ctx.rules) {
    const conditions = rule.conditions as Record<string, unknown> | null;
    if (!conditions) continue;

    const checkKey = (conditions.check ?? conditions.preference) as string | undefined;
    if (!checkKey) continue;

    const handler = CHECK_HANDLERS[checkKey];
    if (!handler) continue;

    const result = handler(ctx);
    if (!result) continue;

    if (result.reject) {
      return { valid: false, warnings: [result.reject] };
    }
    if (result.warn) {
      warnings.push(result.warn);
    }
  }

  return { valid: true, warnings };
}
