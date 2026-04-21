import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import { mapBatch } from "@/lib/utils/mappers";
import type { DatabaseRow } from "@/types/database";
import type { Batch } from "@/types/batch";

export function useHistoricalBatches(from: string | null, to: string) {
  const { site } = useCurrentSite();

  return useQuery<Batch[]>({
    queryKey: ["batches", "historical", site?.id, from, to],
    queryFn: async () => {
      if (!site) return [];

      let query = supabase
        .from("batches")
        .select("*")
        .eq("site_id", site.id)
        .lte("plan_date", to)
        .order("plan_date", { ascending: true });

      if (from) {
        query = query.gte("plan_date", from);
      }

      const { data, error } = await query;
      if (error) throw error;

      return (data as DatabaseRow["batches"][]).map(mapBatch);
    },
    enabled: !!site && !!to,
    staleTime: 5 * 60 * 1000,
  });
}
