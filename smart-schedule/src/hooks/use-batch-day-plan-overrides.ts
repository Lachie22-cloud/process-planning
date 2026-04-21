import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";

interface UpsertOverrideInput {
  batchId: string;
  planDate: string;
  comment?: string | null;
  holdUpNote?: string | null;
  sortOrder?: number | null;
}

export function useBatchDayPlanOverrides() {
  const { site } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpsertOverrideInput) => {
      if (!site) return;
      const row: Record<string, unknown> = {
        site_id: site.id,
        batch_id: input.batchId,
        plan_date: input.planDate,
        updated_at: new Date().toISOString(),
      };
      if (input.comment !== undefined) row.comment = input.comment;
      if (input.holdUpNote !== undefined) row.hold_up_note = input.holdUpNote;
      if (input.sortOrder !== undefined) row.sort_order = input.sortOrder;

      const { error } = await supabase
        .from("batch_day_plan_overrides")
        .upsert(row, { onConflict: "site_id,batch_id,plan_date" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["filling-day-plan"] });
    },
  });
}

/** Bulk-save sort orders after a drag-reorder */
export function useSaveSortOrders() {
  const { site } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (rows: Array<{ batchId: string; planDate: string; sortOrder: number }>) => {
      if (!site || rows.length === 0) return;
      const inserts = rows.map((r) => ({
        site_id: site.id,
        batch_id: r.batchId,
        plan_date: r.planDate,
        sort_order: r.sortOrder,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase
        .from("batch_day_plan_overrides")
        .upsert(inserts, { onConflict: "site_id,batch_id,plan_date" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["filling-day-plan"] });
    },
  });
}
