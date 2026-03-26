import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import { mapBatch } from "@/lib/utils/mappers";
import type { DatabaseRow } from "@/types/database";
import type { Batch } from "@/types/batch";

export type TimeRange = "2w" | "4w" | "8w" | "all";

const RANGE_DAYS: Record<TimeRange, number | null> = {
  "2w": 14,
  "4w": 28,
  "8w": 56,
  all: null,
};

export function useHistoricalBatches(timeRange: TimeRange) {
  const { site } = useCurrentSite();

  const cutoff = useMemo(() => {
    const days = RANGE_DAYS[timeRange];
    if (days === null) return null;
    return format(subDays(new Date(), days), "yyyy-MM-dd");
  }, [timeRange]);

  return useQuery<Batch[]>({
    queryKey: ["batches", "historical", site?.id, timeRange],
    queryFn: async () => {
      if (!site) return [];

      let query = supabase
        .from("batches")
        .select("*")
        .eq("site_id", site.id)
        .order("plan_date", { ascending: true });

      if (cutoff) {
        query = query.gte("plan_date", cutoff);
      }

      const { data, error } = await query;
      if (error) throw error;

      return (data as DatabaseRow["batches"][]).map(mapBatch);
    },
    enabled: !!site,
    staleTime: 5 * 60 * 1000,
  });
}
