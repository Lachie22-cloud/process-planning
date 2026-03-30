import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import { mapLinkedFillOrder } from "@/lib/utils/mappers";
import { fillOrderHasComponent, RED_LID_COMPONENT, BLUE_LID_COMPONENT } from "@/lib/utils/pack-size";
import type { DatabaseRow } from "@/types/database";
import type { LinkedFillOrder } from "@/types/batch";

export interface LidFlags {
  hasRedLid: boolean;
  hasBlueLid: boolean;
}

/**
 * Load linked fill orders for a set of batches and compute
 * red-lid / blue-lid flags per batch.
 */
export function useBatchLidFlags(batchIds: string[]) {
  const { site } = useCurrentSite();

  const { data: fillOrders = [] } = useQuery<LinkedFillOrder[]>({
    queryKey: ["batch_lid_flags", site?.id, batchIds],
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
        if (error) throw error;
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
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    const map = new Map<string, LidFlags>();
    if (fillOrders.length === 0) return map;

    // Group fill orders by batch
    const byBatch = new Map<string, LinkedFillOrder[]>();
    for (const fo of fillOrders) {
      const list = byBatch.get(fo.batchId) ?? [];
      list.push(fo);
      byBatch.set(fo.batchId, list);
    }

    for (const [batchId, fos] of byBatch) {
      const hasRedLid = fos.some((fo) =>
        fillOrderHasComponent(
          { components: fo.components, fillMaterial: fo.fillMaterial, lidType: fo.lidType },
          RED_LID_COMPONENT,
        ),
      );
      const hasBlueLid = fos.some((fo) =>
        fillOrderHasComponent(
          { components: fo.components, fillMaterial: fo.fillMaterial, lidType: fo.lidType },
          BLUE_LID_COMPONENT,
        ),
      );
      if (hasRedLid || hasBlueLid) {
        map.set(batchId, { hasRedLid, hasBlueLid });
      }
    }

    return map;
  }, [fillOrders]);
}
