import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  disperser1Id?: string | null;
  disperser2Id?: string | null;
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
        disperser1_id: input.disperser1Id ?? null,
        disperser2_id: input.disperser2Id ?? null,
      } as never);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedule-movements"] });
    },
  });
}

export interface MovementInfo {
  direction: "pulled" | "pushed" | "moved";
  reason: string | null;
}

/**
 * Fetch the most recent movement direction per batch for the given date range.
 * Returns a Map<batchId, MovementInfo>.
 */
export function useMovementDirections({
  weekStart,
  weekEnding,
  enabled = true,
}: {
  weekStart: string;
  weekEnding: string;
  enabled?: boolean;
}) {
  const { site } = useCurrentSite();

  return useQuery({
    queryKey: ["schedule-movements", site?.id, weekStart, weekEnding],
    enabled: enabled && !!site,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_movements")
        .select("batch_id, direction, reason, moved_at")
        .eq("site_id", site!.id)
        .gte("to_date", weekStart)
        .lte("to_date", weekEnding)
        .order("moved_at", { ascending: false });

      if (error) throw error;

      // Keep only the most recent movement per batch
      const map = new Map<string, MovementInfo>();
      for (const row of data ?? []) {
        if (row.batch_id && !map.has(row.batch_id)) {
          map.set(row.batch_id, {
            direction: row.direction as "pulled" | "pushed" | "moved",
            reason: (row.reason as string) ?? null,
          });
        }
      }
      return map;
    },
  });
}
