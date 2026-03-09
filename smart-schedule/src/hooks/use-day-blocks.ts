import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";

export interface DayBlock {
  id: string;
  siteId: string;
  blockDate: string;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
}

interface UseDayBlocksOptions {
  weekStart?: string;
  weekEnding?: string;
}

export function useDayBlocks(options: UseDayBlocksOptions = {}) {
  const { site } = useCurrentSite();

  return useQuery<DayBlock[]>({
    queryKey: ["day_blocks", site?.id, options],
    queryFn: async () => {
      if (!site) return [];

      let query = supabase
        .from("day_blocks")
        .select("*")
        .eq("site_id", site.id);

      if (options.weekStart) {
        query = query.gte("block_date", options.weekStart);
      }
      if (options.weekEnding) {
        query = query.lte("block_date", options.weekEnding);
      }

      const { data, error } = await query.order("block_date");
      if (error) throw error;

      return (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        siteId: row.site_id as string,
        blockDate: row.block_date as string,
        reason: row.reason as string | null,
        createdBy: row.created_by as string | null,
        createdAt: row.created_at as string,
      }));
    },
    enabled: !!site,
  });
}

export function useAddDayBlock() {
  const { site } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { blockDate: string; reason?: string }) => {
      if (!site) throw new Error("No site selected");

      const { error } = await supabase.from("day_blocks").insert({
        site_id: site.id,
        block_date: input.blockDate,
        reason: input.reason ?? null,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["day_blocks", site?.id] });
      toast.success("Day blocked");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to block day");
    },
  });
}

export function useRemoveDayBlock() {
  const { site } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (blockId: string) => {
      const { error } = await supabase
        .from("day_blocks")
        .delete()
        .eq("id", blockId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["day_blocks", site?.id] });
      toast.success("Day block removed");
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to remove day block",
      );
    },
  });
}
