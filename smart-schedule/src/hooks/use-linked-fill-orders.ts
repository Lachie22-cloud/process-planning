import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import { mapLinkedFillOrder } from "@/lib/utils/mappers";
import type { LinkedFillOrder } from "@/types/batch";
import type { DatabaseRow } from "@/types/database";

/**
 * Fetch all linked fill orders for a set of batch IDs.
 * Chunks queries to respect Supabase .in() limits.
 */
export function useLinkedFillOrders(batchIds: string[]) {
  const { site } = useCurrentSite();

  return useQuery<LinkedFillOrder[]>({
    queryKey: ["linked_fill_orders", site?.id, batchIds],
    queryFn: async () => {
      if (!site || batchIds.length === 0) return [];

      const chunkSize = 200;
      const results: LinkedFillOrder[] = [];
      for (let i = 0; i < batchIds.length; i += chunkSize) {
        const chunk = batchIds.slice(i, i + chunkSize);
        const { data, error } = await supabase
          .from("linked_fill_orders")
          .select("*")
          .eq("site_id", site.id)
          .in("batch_id", chunk);
        if (error) {
          console.error("Failed to fetch linked_fill_orders:", error);
          throw error;
        }
        if (data) {
          results.push(
            ...data.map((r: Record<string, unknown>) =>
              mapLinkedFillOrder(r as DatabaseRow["linked_fill_orders"]),
            ),
          );
        }
      }
      return results;
    },
    enabled: !!site && batchIds.length > 0,
    retry: 2,
  });
}
