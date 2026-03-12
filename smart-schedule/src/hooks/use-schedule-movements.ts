import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";

interface RecordMovementInput {
  batchId: string;
  fromResourceId: string | null;
  toResourceId: string | null;
  fromDate: string | null;
  toDate: string | null;
  direction: "pulled" | "pushed" | "moved";
  reason: string | null;
}

/**
 * Insert an immutable record into schedule_movements.
 * Used alongside audit_log to track every batch move.
 */
export function useRecordMovement() {
  const { site, user } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: RecordMovementInput) => {
      if (!site) throw new Error("No site selected");

      const { error } = await supabase.from("schedule_movements").insert({
        site_id: site.id,
        batch_id: input.batchId,
        from_resource_id: input.fromResourceId,
        to_resource_id: input.toResourceId,
        from_date: input.fromDate,
        to_date: input.toDate,
        direction: input.direction,
        reason: input.reason,
        moved_by: user?.id ?? null,
      } as never);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedule-movements"] });
    },
  });
}
