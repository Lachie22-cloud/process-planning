import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import type { DatabaseRow } from "@/types/database";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface AiConfig {
  id: string;
  siteId: string;
  keyType: DatabaseRow["ai_config"]["key_type"];
  credentialHint: string | null;
  credentialStatus: DatabaseRow["ai_config"]["credential_status"];
  credentialExpiresAt: string | null;
  credentialLastValidatedAt: string | null;
  keyVersion: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

function mapAiConfig(row: DatabaseRow["ai_config"]): AiConfig {
  return {
    id: row.id,
    siteId: row.site_id,
    keyType: row.key_type,
    credentialHint: row.credential_hint,
    credentialStatus: row.credential_status,
    credentialExpiresAt: row.credential_expires_at,
    credentialLastValidatedAt: row.credential_last_validated_at,
    keyVersion: row.key_version,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ------------------------------------------------------------------ */
/*  Queries                                                            */
/* ------------------------------------------------------------------ */

export function useAiConfig() {
  const { site } = useCurrentSite();

  return useQuery<AiConfig | null>({
    queryKey: ["ai_config", site?.id],
    queryFn: async () => {
      if (!site) return null;

      const { data, error } = await supabase
        .from("ai_config")
        .select(
          "id, site_id, key_type, credential_hint, credential_status, credential_expires_at, credential_last_validated_at, key_version, enabled, created_at, updated_at",
        )
        .eq("site_id", site.id)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;
      return mapAiConfig(data as DatabaseRow["ai_config"]);
    },
    enabled: !!site,
  });
}

/* ------------------------------------------------------------------ */
/*  Mutations                                                          */
/* ------------------------------------------------------------------ */

export function useToggleAiConfig() {
  const { site, user } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!site) throw new Error("No site selected");

      const { error } = await supabase
        .from("ai_config")
        .update({ enabled, updated_by: user?.id ?? null } as never)
        .eq("site_id", site.id);

      if (error) throw error;

      await supabase.from("audit_log").insert({
        site_id: site.id,
        action: enabled ? "ai_config.enabled" : "ai_config.disabled",
        details: {},
        performed_by: user?.email ?? null,
      } as never);
    },
    onSuccess: (_, enabled) => {
      queryClient.invalidateQueries({ queryKey: ["ai_config", site?.id] });
      toast.success(enabled ? "AI integration enabled" : "AI integration disabled");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to update AI config");
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getAiAgentUrl(): string {
  // Empty string is valid — means same origin (behind reverse proxy)
  return (import.meta.env.VITE_AI_AGENT_URL as string | undefined) ?? "";
}

async function getAccessToken(): Promise<string> {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) throw new Error("Not authenticated");
  return session.access_token;
}

async function aiAgentFetch<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${getAiAgentUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
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
/*  Set Credential                                                     */
/* ------------------------------------------------------------------ */

interface SetCredentialInput {
  keyType: "anthropic_api_key" | "claude_auth_token";
  credential: string;
}

export function useSetAiCredential() {
  const { site } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SetCredentialInput) => {
      if (!site) throw new Error("No site selected");

      return aiAgentFetch<{ success: boolean; hint: string; keyVersion: number }>(
        "/ai/admin/credentials/set",
        { siteId: site.id, keyType: input.keyType, credential: input.credential },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai_config", site?.id] });
      toast.success("Credential saved successfully");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to set credential");
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Rotate Credential (encryption key rotation)                        */
/* ------------------------------------------------------------------ */

export function useRotateAiCredential() {
  const { site } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!site) throw new Error("No site selected");

      return aiAgentFetch<{ success: boolean; keyVersion: number; hint: string }>(
        "/ai/admin/credentials/rotate",
        { siteId: site.id },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai_config", site?.id] });
      toast.success("Credential rotated successfully");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to rotate credential");
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Test Credential                                                    */
/* ------------------------------------------------------------------ */

export function useTestAiCredential() {
  const { site } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!site) throw new Error("No site selected");

      return aiAgentFetch<{ valid: boolean; message?: string }>(
        "/ai/admin/credentials/test",
        { siteId: site.id },
      );
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["ai_config", site?.id] });
      if (result.valid) {
        toast.success("Credential is valid");
      } else {
        toast.error(result.message ?? "Credential is invalid");
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Credential test failed");
    },
  });
}
