import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import type { DatabaseRow, Json } from "@/types/database";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type DraftType = DatabaseRow["ai_drafts"]["draft_type"];
export type DraftStatus = DatabaseRow["ai_drafts"]["status"];

export interface AiDraft {
  id: string;
  siteId: string;
  scanId: string | null;
  draftType: DraftType;
  title: string;
  description: string | null;
  payload: Json;
  status: DraftStatus;
  createdBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewComment: string | null;
  appliedBy: string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
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

function mapDraft(row: DatabaseRow["ai_drafts"]): AiDraft {
  return {
    id: row.id,
    siteId: row.site_id,
    scanId: row.scan_id,
    draftType: row.draft_type,
    title: row.title,
    description: row.description,
    payload: row.payload,
    status: row.status,
    createdBy: row.created_by,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewComment: row.review_comment,
    appliedBy: row.applied_by,
    appliedAt: row.applied_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ------------------------------------------------------------------ */
/*  useAiDrafts — fetch drafts for current site                        */
/* ------------------------------------------------------------------ */

export function useAiDrafts(statusFilter?: DraftStatus) {
  const { site } = useCurrentSite();

  return useQuery<AiDraft[]>({
    queryKey: ["ai_drafts", site?.id, statusFilter],
    queryFn: async () => {
      if (!site) return [];

      let query = supabase
        .from("ai_drafts")
        .select("*")
        .eq("site_id", site.id)
        .order("created_at", { ascending: false });

      if (statusFilter) {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((row) => mapDraft(row as DatabaseRow["ai_drafts"]));
    },
    enabled: !!site,
    staleTime: 10_000,
  });
}

/* ------------------------------------------------------------------ */
/*  useApproveDraft                                                    */
/* ------------------------------------------------------------------ */

export function useApproveDraft() {
  const { site } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      draftId,
      comment,
    }: {
      draftId: string;
      comment?: string;
    }) => {
      const token = await getAccessToken();
      const res = await fetch(`${getAiAgentUrl()}/ai/drafts/${draftId}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ comment }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(
          (payload as { error?: string }).error ?? `Approve failed (${res.status})`,
        );
      }
      return (await res.json()) as { id: string; status: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai_drafts", site?.id] });
      toast.success("Draft approved");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to approve draft");
    },
  });
}

/* ------------------------------------------------------------------ */
/*  useRejectDraft                                                     */
/* ------------------------------------------------------------------ */

export function useRejectDraft() {
  const { site } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      draftId,
      comment,
    }: {
      draftId: string;
      comment: string;
    }) => {
      const token = await getAccessToken();
      const res = await fetch(`${getAiAgentUrl()}/ai/drafts/${draftId}/reject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ comment }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(
          (payload as { error?: string }).error ?? `Reject failed (${res.status})`,
        );
      }
      return (await res.json()) as { id: string; status: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai_drafts", site?.id] });
      toast.success("Draft rejected");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to reject draft");
    },
  });
}

/* ------------------------------------------------------------------ */
/*  useApplyDraft                                                      */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  useCreateDraft — insert a new draft for review                     */
/* ------------------------------------------------------------------ */

export function useCreateDraft() {
  const { site } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (draft: {
      draftType: DraftType;
      title: string;
      description: string;
      payload: Json;
      scanId?: string | null;
    }) => {
      if (!site) throw new Error("No site selected");

      const { data, error } = await supabase
        .from("ai_drafts")
        .insert({
          site_id: site.id,
          draft_type: draft.draftType,
          title: draft.title,
          description: draft.description,
          payload: draft.payload,
          status: "pending" as const,
          scan_id: draft.scanId ?? null,
        })
        .select("id")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai_drafts", site?.id] });
    },
  });
}

/* ------------------------------------------------------------------ */
/*  useApplyDraft                                                      */
/* ------------------------------------------------------------------ */

export function usePurgeDrafts() {
  const { site } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!site) throw new Error("No site selected");

      const { error } = await supabase
        .from("ai_drafts")
        .delete()
        .eq("site_id", site.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai_drafts", site?.id] });
      toast.success("All drafts purged");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to purge drafts");
    },
  });
}

/* ------------------------------------------------------------------ */
/*  useApplyDraft                                                      */
/* ------------------------------------------------------------------ */

export function useApplyDraft() {
  const { site } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (draftId: string) => {
      const token = await getAccessToken();
      const res = await fetch(`${getAiAgentUrl()}/ai/drafts/${draftId}/apply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(
          (payload as { error?: string }).error ?? `Apply failed (${res.status})`,
        );
      }
      return (await res.json()) as { id: string; status: string; appliedAt: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai_drafts", site?.id] });
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
      toast.success("Draft applied successfully");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to apply draft");
    },
  });
}
