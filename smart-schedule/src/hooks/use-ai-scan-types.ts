import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import type { DatabaseRow } from "@/types/database";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface AiScanType {
  id: string;
  siteId: string;
  key: string;
  label: string;
  description: string | null;
  aiObjective: string | null;
  enabled: boolean;
  isDefault: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiScanTypeInput {
  key: string;
  label: string;
  description?: string | null;
  aiObjective?: string | null;
  enabled?: boolean;
  sortOrder?: number;
}

export interface AiScanTypeUpdateInput {
  id: string;
  key?: string;
  label?: string;
  description?: string | null;
  aiObjective?: string | null;
  enabled?: boolean;
  sortOrder?: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function mapScanType(row: DatabaseRow["ai_scan_types"]): AiScanType {
  return {
    id: row.id,
    siteId: row.site_id,
    key: row.key,
    label: row.label,
    description: row.description,
    aiObjective: row.ai_objective,
    enabled: row.enabled,
    isDefault: row.is_default,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ------------------------------------------------------------------ */
/*  useAiScanTypes — fetch scan types for current site                 */
/* ------------------------------------------------------------------ */

export function useAiScanTypes(enabledOnly = false) {
  const { site } = useCurrentSite();

  return useQuery<AiScanType[]>({
    queryKey: ["ai_scan_types", site?.id, enabledOnly],
    queryFn: async () => {
      if (!site) return [];

      let query = supabase
        .from("ai_scan_types")
        .select("*")
        .eq("site_id", site.id)
        .order("sort_order", { ascending: true });

      if (enabledOnly) {
        query = query.eq("enabled", true);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((row) =>
        mapScanType(row as DatabaseRow["ai_scan_types"]),
      );
    },
    enabled: !!site,
    staleTime: 30_000,
  });
}

/* ------------------------------------------------------------------ */
/*  Mutations                                                          */
/* ------------------------------------------------------------------ */

export function useCreateScanType() {
  const { site } = useCurrentSite();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: AiScanTypeInput) => {
      if (!site) throw new Error("No site selected");

      const { data, error } = await supabase
        .from("ai_scan_types")
        .insert({
          site_id: site.id,
          key: input.key,
          label: input.label,
          description: input.description ?? null,
          ai_objective: input.aiObjective ?? null,
          enabled: input.enabled ?? true,
          sort_order: input.sortOrder ?? 0,
          is_default: false,
        })
        .select("*")
        .single();

      if (error) throw error;
      return mapScanType(data as DatabaseRow["ai_scan_types"]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai_scan_types", site?.id] });
      toast.success("Scan type created");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to create scan type");
    },
  });
}

export function useUpdateScanType() {
  const { site } = useCurrentSite();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: AiScanTypeUpdateInput) => {
      if (!site) throw new Error("No site selected");

      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (input.key !== undefined) updates.key = input.key;
      if (input.label !== undefined) updates.label = input.label;
      if (input.description !== undefined) updates.description = input.description;
      if (input.aiObjective !== undefined) updates.ai_objective = input.aiObjective;
      if (input.enabled !== undefined) updates.enabled = input.enabled;
      if (input.sortOrder !== undefined) updates.sort_order = input.sortOrder;

      const { data, error } = await supabase
        .from("ai_scan_types")
        .update(updates)
        .eq("id", input.id)
        .select("*")
        .single();

      if (error) throw error;
      return mapScanType(data as DatabaseRow["ai_scan_types"]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai_scan_types", site?.id] });
      toast.success("Scan type updated");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to update scan type");
    },
  });
}

export function useDeleteScanType() {
  const { site } = useCurrentSite();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: string | Pick<AiScanType, "id" | "isDefault">) => {
      if (!site) throw new Error("No site selected");

      const id = typeof input === "string" ? input : input.id;
      const isDefault = typeof input === "string" ? false : input.isDefault;

      if (isDefault) {
        throw new Error("Default scan types cannot be deleted");
      }

      const { error } = await supabase
        .from("ai_scan_types")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai_scan_types", site?.id] });
      toast.success("Scan type deleted");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to delete scan type");
    },
  });
}
