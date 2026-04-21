import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";

interface UpsertMetaInput {
  planDate: string;
  trunkLeaders: Record<string, string>;
}

export function useFillingDayPlanMeta() {
  const { site } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ planDate, trunkLeaders }: UpsertMetaInput) => {
      if (!site) return;
      const { error } = await supabase
        .from("filling_day_plan_meta")
        .upsert(
          {
            site_id: site.id,
            plan_date: planDate,
            trunk_leaders: trunkLeaders,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "site_id,plan_date" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["filling-day-plan"] });
    },
  });
}
