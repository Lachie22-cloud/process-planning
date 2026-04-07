import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import { mapBatch } from "@/lib/utils/mappers";
import type { DatabaseRow } from "@/types/database";
import type { Batch } from "@/types/batch";

/** Build a pack-size summary string per batch from linked fill orders */
async function enrichPackSizeSummaries(batches: Batch[], siteId: string): Promise<Batch[]> {
  if (batches.length === 0) return batches;

  const batchIds = batches.map((b) => b.id);
  const { data: fillRows, error } = await supabase
    .from("linked_fill_orders")
    .select("batch_id, pack_size")
    .eq("site_id", siteId)
    .in("batch_id", batchIds);

  if (error || !fillRows) return batches;

  // Group unique pack sizes by batch_id
  const summaryMap = new Map<string, Set<string>>();
  for (const row of fillRows) {
    if (!row.pack_size) continue;
    let set = summaryMap.get(row.batch_id);
    if (!set) {
      set = new Set();
      summaryMap.set(row.batch_id, set);
    }
    set.add(row.pack_size);
  }

  return batches.map((b) => {
    const sizes = summaryMap.get(b.id);
    return sizes && sizes.size > 0
      ? { ...b, packSizeSummary: [...sizes].join(", ") }
      : b;
  });
}

interface UseBatchesOptions {
  weekStart?: string;
  weekEnding?: string;
  status?: string;
  resourceId?: string;
}

export function useBatches(options: UseBatchesOptions = {}) {
  const { site } = useCurrentSite();

  return useQuery<Batch[]>({
    queryKey: ["batches", site?.id, options],
    queryFn: async () => {
      if (!site) return [];

      let query = supabase
        .from("batches")
        .select("*")
        .eq("site_id", site.id)
        .order("plan_date", { ascending: true });

      if (options.weekStart) {
        query = query.gte("plan_date", options.weekStart);
      }

      if (options.weekEnding) {
        query = query.lte("plan_date", options.weekEnding);
      }

      if (options.status) {
        query = query.eq("status", options.status);
      }

      if (options.resourceId) {
        query = query.eq("plan_resource_id", options.resourceId);
      }

      const { data, error } = await query;
      if (error) throw error;

      const batches = (data as DatabaseRow["batches"][]).map(mapBatch);
      return enrichPackSizeSummaries(batches, site.id);
    },
    enabled: !!site,
  });
}

export function useBatch(batchId: string | null) {
  const { site } = useCurrentSite();

  return useQuery<Batch | null>({
    queryKey: ["batches", "detail", batchId],
    queryFn: async () => {
      if (!batchId || !site) return null;

      const { data, error } = await supabase
        .from("batches")
        .select("*")
        .eq("id", batchId)
        .eq("site_id", site.id)
        .single();

      if (error) throw error;
      return mapBatch(data as DatabaseRow["batches"]);
    },
    enabled: !!batchId && !!site,
  });
}
