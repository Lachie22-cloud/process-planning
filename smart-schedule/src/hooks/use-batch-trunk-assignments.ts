import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";

interface TrunkAssignment {
  trunkLine: string;
  fillOrderIds: string[];
}

interface SaveTrunkAssignmentsInput {
  batchId: string;
  planDate: string;
  /** Full replacement: all existing rows for this batch+date are deleted first */
  assignments: TrunkAssignment[];
}

export function useBatchTrunkAssignments() {
  const { site } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ batchId, planDate, assignments }: SaveTrunkAssignmentsInput) => {
      if (!site) return;

      // Delete all existing trunk assignments for this batch+date
      const { error: delErr } = await supabase
        .from("batch_trunk_assignments")
        .delete()
        .eq("site_id", site.id)
        .eq("batch_id", batchId)
        .eq("plan_date", planDate);
      if (delErr) throw delErr;

      if (assignments.length === 0) return;

      const rows = assignments
        .filter((a) => a.fillOrderIds.length > 0)
        .map((a) => ({
          site_id: site.id,
          batch_id: batchId,
          plan_date: planDate,
          trunk_line: a.trunkLine,
          fill_order_ids: a.fillOrderIds,
          updated_at: new Date().toISOString(),
        }));

      if (rows.length === 0) return;

      const { error } = await supabase.from("batch_trunk_assignments").insert(rows);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["filling-day-plan"] });
    },
  });
}
