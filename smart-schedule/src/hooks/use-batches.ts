import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import { mapBatch } from "@/lib/utils/mappers";
import type { DatabaseRow } from "@/types/database";
import type { Batch } from "@/types/batch";

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

      return (data as DatabaseRow["batches"][]).map(mapBatch);
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
