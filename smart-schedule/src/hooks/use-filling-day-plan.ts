import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import { mapBatch, mapLinkedFillOrder } from "@/lib/utils/mappers";
import type { Batch, LinkedFillOrder } from "@/types/batch";
import type { DatabaseRow } from "@/types/database";
import type {
  FillingOverride,
  DayPlanMeta,
  GhostJob,
  FoAssignments,
} from "@/components/filling/types";

const FILLABLE_STATUSES = [
  "Ready to Fill",
  "Filling",
  "On Test",
  "In Progress",
  "OFF WOM",
  "OFF WOP",
  "Hold",
  "NCB",
] as const;

export interface FillingBatch extends Batch {
  linkedFillOrders: LinkedFillOrder[];
}

export interface FillingDayPlanData {
  batches: FillingBatch[];
  overrideMap: Record<string, FillingOverride>;
  foAssignments: FoAssignments;
  meta: DayPlanMeta | null;
  ghosts: GhostJob[];
}

function mapOverride(row: Record<string, unknown>): FillingOverride {
  return {
    id: row.id as string,
    batchId: row.batch_id as string,
    planDate: row.plan_date as string,
    comment: (row.comment as string | null) ?? null,
    holdUpNote: (row.hold_up_note as string | null) ?? null,
    sortOrder: (row.sort_order as number | null) ?? null,
  };
}

export function useFillingDayPlan(planDate: string | null) {
  const { site } = useCurrentSite();

  return useQuery<FillingDayPlanData>({
    queryKey: ["filling-day-plan", site?.id, planDate],
    enabled: !!site && !!planDate,
    staleTime: 30_000,
    queryFn: async (): Promise<FillingDayPlanData> => {
      if (!site || !planDate) {
        return { batches: [], overrideMap: {}, foAssignments: {}, meta: null, ghosts: [] };
      }

      // ── Core batch query ────────────────────────────────────────────────
      const { data: batchRows, error: batchErr } = await supabase
        .from("batches")
        .select("*")
        .eq("site_id", site.id)
        .eq("plan_date", planDate)
        .in("status", FILLABLE_STATUSES)
        .not("plan_resource_id", "is", null)
        .order("status", { ascending: true });

      if (batchErr) throw batchErr;

      const batches = (batchRows as DatabaseRow["batches"][]).map(mapBatch);

      let enrichedBatches: FillingBatch[] = batches.map((b) => ({
        ...b,
        linkedFillOrders: [],
      }));

      if (batches.length > 0) {
        const batchIds = batches.map((b) => b.id);
        const { data: fillRows, error: fillErr } = await supabase
          .from("linked_fill_orders")
          .select("*")
          .eq("site_id", site.id)
          .in("batch_id", batchIds);

        if (fillErr) throw fillErr;

        const fillsByBatch = new Map<string, LinkedFillOrder[]>();
        for (const row of fillRows ?? []) {
          const existing = fillsByBatch.get(row.batch_id) ?? [];
          existing.push(mapLinkedFillOrder(row as DatabaseRow["linked_fill_orders"]));
          fillsByBatch.set(row.batch_id, existing);
        }

        enrichedBatches = batches.map((b) => ({
          ...b,
          linkedFillOrders: fillsByBatch.get(b.id) ?? [],
        }));
      }

      // ── Phase 2: overrides + meta (graceful degradation if tables absent) ──
      const overrideMap: Record<string, FillingOverride> = {};
      let meta: DayPlanMeta | null = null;
      let ghosts: GhostJob[] = [];

      try {
        const { data: overrideRows } = await supabase
          .from("batch_day_plan_overrides")
          .select("*")
          .eq("site_id", site.id)
          .eq("plan_date", planDate);

        if (overrideRows) {
          for (const row of overrideRows) {
            overrideMap[row.batch_id as string] = mapOverride(row as Record<string, unknown>);
          }
        }

        // Ghost rows: overrides where the batch has since moved to a different date
        const batchIdsInPlan = new Set(enrichedBatches.map((b) => b.id));
        const ghostOverrides = overrideRows?.filter(
          (r) => !batchIdsInPlan.has(r.batch_id as string),
        ) ?? [];

        if (ghostOverrides.length > 0) {
          const ghostBatchIds = ghostOverrides.map((r) => r.batch_id as string);
          const { data: ghostBatchRows } = await supabase
            .from("batches")
            .select("id, sap_order, status, plan_date, plan_resource_id")
            .eq("site_id", site.id)
            .in("id", ghostBatchIds);

          const ghostBatchMap = new Map(
            (ghostBatchRows ?? []).map((r) => [r.id as string, r]),
          );

          ghosts = ghostOverrides.map((r) => {
            const gb = ghostBatchMap.get(r.batch_id as string);
            return {
              batchId: r.batch_id as string,
              sapOrder: (gb?.sap_order as string | null) ?? "—",
              status: (gb?.status as string | null) ?? "—",
              originalTrunkLine: null,
              movedToPlanDate: (gb?.plan_date as string | null) ?? null,
            };
          });
        }
      } catch {
        // Table not yet created — silently degrade
      }

      try {
        const { data: metaRow } = await supabase
          .from("filling_day_plan_meta")
          .select("*")
          .eq("site_id", site.id)
          .eq("plan_date", planDate)
          .maybeSingle();

        if (metaRow) {
          meta = {
            id: metaRow.id as string,
            planDate: metaRow.plan_date as string,
            trunkLeaders: (metaRow.trunk_leaders as Record<string, string>) ?? {},
          };
        }
      } catch {
        // Table not yet created — silently degrade
      }

      // ── Phase 3: trunk assignments → foAssignments map ─────────────────
      const foAssignments: FoAssignments = {};

      try {
        const { data: trunkRows } = await supabase
          .from("batch_trunk_assignments")
          .select("trunk_line, fill_order_ids")
          .eq("site_id", site.id)
          .eq("plan_date", planDate);

        if (trunkRows) {
          for (const row of trunkRows) {
            const foIds = row.fill_order_ids as string[] | null;
            if (!foIds) continue;
            for (const foId of foIds) {
              foAssignments[foId] = row.trunk_line as string;
            }
          }
        }
      } catch {
        // Table not yet created — silently degrade
      }

      return { batches: enrichedBatches, overrideMap, foAssignments, meta, ghosts };
    },
  });
}
