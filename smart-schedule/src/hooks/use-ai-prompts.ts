import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface AiPromptSection {
  id: string;
  site_id: string;
  section_key: string;
  label: string;
  content: string;
  context: "chat" | "scan" | "both";
  sort_order: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
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

async function aiAgentFetch<T>(
  path: string,
  options: { method?: string; body?: Record<string, unknown> } = {},
): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${getAiAgentUrl()}${path}`, {
    method: options.method ?? "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(
      (payload as { error?: string }).error ?? `Request failed (${res.status})`,
    );
  }
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ */
/*  Queries                                                            */
/* ------------------------------------------------------------------ */

export function useAiPromptSections() {
  const { site } = useCurrentSite();

  return useQuery<AiPromptSection[]>({
    queryKey: ["ai_prompt_sections", site?.id],
    queryFn: async () => {
      if (!site) return [];

      const result = await aiAgentFetch<{ sections: AiPromptSection[] }>(
        `/ai/admin/prompt-sections?siteId=${encodeURIComponent(site.id)}`,
        { method: "GET" },
      );
      return result.sections;
    },
    enabled: !!site,
  });
}

/* ------------------------------------------------------------------ */
/*  Mutations                                                          */
/* ------------------------------------------------------------------ */

interface UpdateSectionInput {
  id: string;
  content?: string;
  enabled?: boolean;
  label?: string;
}

export function useUpdatePromptSection() {
  const { site } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateSectionInput) => {
      if (!site) throw new Error("No site selected");

      return aiAgentFetch<{ section: AiPromptSection }>(
        `/ai/admin/prompt-sections/${input.id}`,
        {
          method: "PUT",
          body: {
            siteId: site.id,
            ...(input.content !== undefined ? { content: input.content } : {}),
            ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
            ...(input.label !== undefined ? { label: input.label } : {}),
          },
        },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["ai_prompt_sections", site?.id],
      });
      toast.success("Section updated");
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to update section",
      );
    },
  });
}

export function useResetPromptSections() {
  const { site } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!site) throw new Error("No site selected");

      return aiAgentFetch<{ sections: AiPromptSection[] }>(
        "/ai/admin/prompt-sections/reset",
        { body: { siteId: site.id } },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["ai_prompt_sections", site?.id],
      });
      toast.success("Prompt sections reset to defaults");
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to reset sections",
      );
    },
  });
}
