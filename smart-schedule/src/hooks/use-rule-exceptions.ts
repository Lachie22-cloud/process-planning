import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import type { DatabaseRow, Json } from "@/types/database";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface RuleException {
  id: string;
  siteId: string;
  ruleId: string;
  reason: string;
  exceptionType: "suspend" | "override" | "modify";
  overrideConfig: Record<string, unknown>;
  startsAt: string;
  expiresAt: string | null;
  createdBy: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Mapper                                                             */
/* ------------------------------------------------------------------ */

function mapRuleException(row: DatabaseRow["rule_exceptions"]): RuleException {
  return {
    id: row.id,
    siteId: row.site_id,
    ruleId: row.rule_id,
    reason: row.reason,
    exceptionType: row.exception_type,
    overrideConfig: (row.override_config ?? {}) as Record<string, unknown>,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/* ------------------------------------------------------------------ */
/*  Queries                                                            */
/* ------------------------------------------------------------------ */

export function useRuleExceptions(ruleId?: string) {
  const { site } = useCurrentSite();

  return useQuery<RuleException[]>({
    queryKey: ["rule-exceptions", site?.id, ruleId],
    queryFn: async () => {
      if (!site) return [];

      let query = supabase
        .from("rule_exceptions")
        .select("*")
        .eq("site_id", site.id)
        .order("created_at", { ascending: false });

      if (ruleId) {
        query = query.eq("rule_id", ruleId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data as DatabaseRow["rule_exceptions"][]).map(mapRuleException);
    },
    enabled: !!site,
  });
}

/** Query only active (non-expired) exceptions */
export function useActiveRuleExceptions() {
  const { site } = useCurrentSite();

  return useQuery<RuleException[]>({
    queryKey: ["rule-exceptions", "active", site?.id],
    queryFn: async () => {
      if (!site) return [];

      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("rule_exceptions")
        .select("*")
        .eq("site_id", site.id)
        .lte("starts_at", now)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data as DatabaseRow["rule_exceptions"][]).map(mapRuleException);
    },
    enabled: !!site,
  });
}

/* ------------------------------------------------------------------ */
/*  Mutations                                                          */
/* ------------------------------------------------------------------ */

interface CreateRuleExceptionInput {
  ruleId: string;
  reason: string;
  exceptionType: "suspend" | "override" | "modify";
  overrideConfig?: Record<string, unknown>;
  startsAt?: string;
  expiresAt?: string | null;
}

export function useCreateRuleException() {
  const queryClient = useQueryClient();
  const { site, user } = useCurrentSite();

  return useMutation({
    mutationFn: async (input: CreateRuleExceptionInput) => {
      if (!site) throw new Error("No site selected");

      const { data, error } = await supabase
        .from("rule_exceptions")
        .insert({
          site_id: site.id,
          rule_id: input.ruleId,
          reason: input.reason.trim(),
          exception_type: input.exceptionType,
          override_config: (input.overrideConfig ?? {}) as unknown as Json,
          starts_at: input.startsAt ?? new Date().toISOString(),
          expires_at: input.expiresAt ?? null,
          created_by: user?.email ?? null,
        } as never)
        .select()
        .single();

      if (error) throw error;
      return mapRuleException(data as DatabaseRow["rule_exceptions"]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rule-exceptions"] });
      toast.success("Rule exception created");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to create exception");
    },
  });
}

export function useDeleteRuleException() {
  const queryClient = useQueryClient();
  const { site } = useCurrentSite();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!site) throw new Error("No site selected");

      const { error } = await supabase
        .from("rule_exceptions")
        .delete()
        .eq("id", id)
        .eq("site_id", site.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rule-exceptions"] });
      toast.success("Rule exception removed");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to delete exception");
    },
  });
}
