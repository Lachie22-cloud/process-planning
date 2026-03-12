import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import { mapAuditEntry } from "@/lib/utils/mappers";
import type { DatabaseRow } from "@/types/database";
import type { AuditEntry } from "@/types/audit";

export function useAuditLog(batchId?: string) {
  const { site } = useCurrentSite();

  return useQuery<AuditEntry[]>({
    queryKey: ["audit", site?.id, batchId],
    queryFn: async () => {
      if (!site) return [];

      let query = supabase
        .from("audit_log")
        .select("*")
        .eq("site_id", site.id)
        .order("performed_at", { ascending: false })
        .limit(100);

      if (batchId) {
        query = query.eq("batch_id", batchId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data as DatabaseRow["audit_log"][]).map(mapAuditEntry);
    },
    enabled: !!site,
  });
}

interface WriteAuditParams {
  siteId: string;
  action: string;
  details?: Record<string, unknown>;
  performedBy?: string | null;
  batchId?: string | null;
}

/** Mutation hook for writing audit log entries */
export function useWriteAuditLog() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: WriteAuditParams) => {
      const { error } = await supabase.from("audit_log").insert({
        site_id: params.siteId,
        action: params.action,
        details: params.details ?? {},
        performed_by: params.performedBy ?? null,
        batch_id: params.batchId ?? null,
      } as never);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}
