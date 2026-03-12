import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import { mapResourceBlock } from "@/lib/utils/mappers";
import type { DatabaseRow } from "@/types/database";
import type { ResourceBlock } from "@/types/site";

interface UseResourceBlocksOptions {
  weekStart?: string;
  weekEnding?: string;
}

export function useResourceBlocks(options: UseResourceBlocksOptions = {}) {
  const { site } = useCurrentSite();

  return useQuery<ResourceBlock[]>({
    queryKey: ["resource_blocks", site?.id, options],
    queryFn: async () => {
      if (!site) return [];

      let query = supabase
        .from("resource_blocks")
        .select("*")
        .eq("site_id", site.id);

      // Fetch blocks that overlap the week range
      if (options.weekStart) {
        query = query.lte("start_date", options.weekEnding ?? options.weekStart);
      }
      if (options.weekEnding) {
        query = query.gte("end_date", options.weekStart ?? options.weekEnding);
      }

      const { data, error } = await query;
      if (error) throw error;

      return (data as DatabaseRow["resource_blocks"][]).map(mapResourceBlock);
    },
    enabled: !!site,
  });
}
