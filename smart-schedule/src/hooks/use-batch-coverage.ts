import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import { mapBatchCoverageItem } from "@/lib/utils/mappers";
import type { BatchCoverageItem } from "@/types/batch";

/**
 * Fetch per-plant ZP40 coverage items for a specific batch.
 * Returns items sorted worst-first (Stock Out → Critical → Low → Good).
 */
export function useBatchCoverage(batchId: string | null) {
  const { site } = useCurrentSite();

  return useQuery<BatchCoverageItem[]>({
    queryKey: ["batch_coverage_items", batchId],
    enabled: !!batchId && !!site,
    queryFn: async () => {
      if (!batchId || !site) return [];
      const { data, error } = await supabase
        .from("batch_coverage_items")
        .select("*")
        .eq("batch_id", batchId)
        .eq("site_id", site.id);
      if (error) throw error;

      const items = (data ?? []).map((row: never) => mapBatchCoverageItem(row));

      // Sort worst coverage first
      const order: Record<string, number> = {
        "Stock Out": 0,
        Critical: 1,
        Low: 2,
        Good: 3,
      };
      return items.sort(
        (a, b) => (order[a.level] ?? 3) - (order[b.level] ?? 3),
      );
    },
  });
}

/**
 * Fetch coverage items for multiple batches in one query.
 * Used for batch cards in the resource timeline to show coverage pills.
 */
export function useBatchesCoverage(batchIds: string[]) {
  const { site } = useCurrentSite();

  return useQuery<Map<string, BatchCoverageItem[]>>({
    queryKey: ["batch_coverage_items", "bulk", ...batchIds.slice(0, 5), batchIds.length],
    enabled: batchIds.length > 0 && !!site,
    queryFn: async () => {
      if (!site || batchIds.length === 0) return new Map();

      // Query in chunks to avoid .in() limits
      const allItems: BatchCoverageItem[] = [];
      const chunkSize = 200;
      for (let i = 0; i < batchIds.length; i += chunkSize) {
        const chunk = batchIds.slice(i, i + chunkSize);
        const { data, error } = await supabase
          .from("batch_coverage_items")
          .select("*")
          .eq("site_id", site.id)
          .in("batch_id", chunk);
        if (error) throw error;
        for (const row of data ?? []) {
          allItems.push(mapBatchCoverageItem(row as never));
        }
      }

      // Group by batchId
      const map = new Map<string, BatchCoverageItem[]>();
      for (const item of allItems) {
        const arr = map.get(item.batchId) ?? [];
        arr.push(item);
        map.set(item.batchId, arr);
      }

      // Sort each batch's items worst-first
      const order: Record<string, number> = {
        "Stock Out": 0,
        Critical: 1,
        Low: 2,
        Good: 3,
      };
      for (const [, items] of map) {
        items.sort((a, b) => (order[a.level] ?? 3) - (order[b.level] ?? 3));
      }

      return map;
    },
  });
}
