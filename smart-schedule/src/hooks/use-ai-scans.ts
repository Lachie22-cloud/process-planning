import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import type { DatabaseRow } from "@/types/database";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ScanType = DatabaseRow["ai_scans"]["scan_type"];
export type ScanStatus = DatabaseRow["ai_scans"]["status"];

export interface AiScan {
  id: string;
  siteId: string;
  scanType: ScanType;
  status: ScanStatus;
  triggeredBy: string | null;
  report: DatabaseRow["ai_scans"]["report"];
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getAiAgentUrl(): string {
  return (import.meta.env.VITE_AI_AGENT_URL as string | undefined) ?? "";
}

async function getAccessToken(): Promise<string> {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) throw new Error("Not authenticated");
  return session.access_token;
}

function mapScan(row: DatabaseRow["ai_scans"]): AiScan {
  return {
    id: row.id,
    siteId: row.site_id,
    scanType: row.scan_type,
    status: row.status,
    triggeredBy: row.triggered_by,
    report: row.report,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

/* ------------------------------------------------------------------ */
/*  useAiScans — fetch recent scans for current site                   */
/* ------------------------------------------------------------------ */

export function useAiScans(limit = 10, enabled = true) {
  const { site } = useCurrentSite();

  return useQuery<AiScan[]>({
    queryKey: ["ai_scans", site?.id, limit],
    queryFn: async () => {
      if (!site) return [];

      const { data, error } = await supabase
        .from("ai_scans")
        .select("*")
        .eq("site_id", site.id)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return (data ?? []).map((row) => mapScan(row as DatabaseRow["ai_scans"]));
    },
    enabled: !!site && enabled,
    staleTime: 5_000,
    refetchInterval: enabled ? 5_000 : false,
  });
}

/* ------------------------------------------------------------------ */
/*  useTriggerScan — trigger a manual scan via AI agent                */
/* ------------------------------------------------------------------ */

export function useTriggerScan() {
  const { site } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ScanType | { scanType: ScanType; promptOverride?: string }) => {
      if (!site) throw new Error("No site selected");

      const scanType = typeof input === "string" ? input : input.scanType;
      const promptOverride = typeof input === "string" ? undefined : input.promptOverride;

      const token = await getAccessToken();
      const res = await fetch(`${getAiAgentUrl()}/ai/scan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ siteId: site.id, scanType, promptOverride }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(
          (payload as { error?: string }).error ?? `Scan request failed (${res.status})`,
        );
      }

      return (await res.json()) as { scanId: string; status: string; createdAt: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["ai_scans", site?.id] });
      toast.success(
        data.status === "pending"
          ? "Scan started — results will appear when complete"
          : "Scan triggered successfully",
      );
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to trigger scan");
    },
  });
}
