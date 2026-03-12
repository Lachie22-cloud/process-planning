import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import { mapSubstitutionRule, mapScheduleRule } from "@/lib/utils/mappers";
import type { DatabaseRow } from "@/types/database";
import type { SubstitutionRule, ScheduleRule } from "@/types/rule";
import type { Json } from "@/types/database";
import {
  scheduleRuleFormSchema,
  substitutionRuleFormSchema,
  parseJsonObject,
  type SubstitutionRuleFormInput,
} from "@/lib/validators/rule";
import {
  substitutionGenerationConfigSchema,
  substitutionGenerationFormSchema,
  type SubstitutionGenerationConfig,
  type SubstitutionGenerationFormInput,
} from "@/lib/validators/substitution-generation-settings";
import { DEFAULT_GENERATION_CONFIG, GENERATION_SETTINGS_VERSION } from "@/lib/constants/substitution-generation-defaults";
import type { CandidateRule } from "@/lib/utils/rule-generation";

/* ------------------------------------------------------------------ */
/*  Queries                                                           */
/* ------------------------------------------------------------------ */

export function useSubstitutionRules() {
  const { site } = useCurrentSite();

  return useQuery<SubstitutionRule[]>({
    queryKey: ["rules", "substitution", site?.id],
    queryFn: async () => {
      if (!site) return [];

      const { data, error } = await supabase
        .from("substitution_rules")
        .select("*")
        .eq("site_id", site.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data as DatabaseRow["substitution_rules"][]).map(mapSubstitutionRule);
    },
    enabled: !!site,
  });
}

export function useScheduleRules() {
  const { site } = useCurrentSite();

  return useQuery<ScheduleRule[]>({
    queryKey: ["rules", "schedule", site?.id],
    queryFn: async () => {
      if (!site) return [];

      const { data, error } = await supabase
        .from("schedule_rules")
        .select("*")
        .eq("site_id", site.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data as DatabaseRow["schedule_rules"][]).map(mapScheduleRule);
    },
    enabled: !!site,
  });
}

/* ------------------------------------------------------------------ */
/*  Schedule Rule Mutations (with validation guardrails)              */
/* ------------------------------------------------------------------ */

interface UpdateScheduleRuleInput {
  id: string;
  name: string;
  description: string | null;
  ruleType: "schedule" | "bulk";
  conditionsText: string;
  actionsText: string;
  enabled: boolean;
  ruleVersion: number;
}

function assertRulesWriteAccess(role?: string) {
  if (role !== "site_admin" && role !== "super_admin") {
    throw new Error("Only site admins can manage rules");
  }
}

async function assertResourcesBelongToSite(
  siteId: string,
  resourceIds: Array<string | null | undefined>,
) {
  const scopedIds = Array.from(
    new Set(resourceIds.filter((id): id is string => Boolean(id))),
  );

  if (scopedIds.length === 0) return;

  const { data, error } = await supabase
    .from("resources")
    .select("id")
    .eq("site_id", siteId)
    .in("id", scopedIds);

  if (error) throw error;

  const foundIds = new Set(
    ((data ?? []) as Array<{ id: string }>).map((row) => row.id),
  );
  const invalidId = scopedIds.find((id) => !foundIds.has(id));
  if (invalidId) {
    throw new Error("Selected resource is not available for the current site");
  }
}

export function useUpdateScheduleRule() {
  const { site, user } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateScheduleRuleInput) => {
      if (!site) throw new Error("No site selected");
      assertRulesWriteAccess(user?.role);

      // Structured validation via Zod (includes schema-version guard)
      const result = scheduleRuleFormSchema.safeParse({
        name: input.name,
        description: input.description,
        ruleType: input.ruleType,
        conditionsText: input.conditionsText,
        actionsText: input.actionsText,
        enabled: input.enabled,
        ruleVersion: input.ruleVersion,
      });

      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join("; ");
        throw new Error(`Validation failed: ${messages}`);
      }

      const parsedConditions = parseJsonObject(input.conditionsText);
      const parsedActions = parseJsonObject(input.actionsText);

      const payload: Record<string, unknown> = {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        rule_type: input.ruleType,
        conditions: (parsedConditions ?? null) as Json,
        actions: (parsedActions ?? null) as Json,
        enabled: input.enabled,
      };

      const { data, error } = await supabase
        .from("schedule_rules")
        .update(payload as never)
        .eq("id", input.id)
        .eq("site_id", site.id)
        .select("*")
        .single();

      if (error) throw error;

      await supabase.from("audit_log").insert({
        site_id: site.id,
        action: "schedule_rule.updated",
        details: { ruleId: input.id, name: input.name, ruleType: input.ruleType },
        performed_by: user?.email ?? null,
      } as never);

      return mapScheduleRule(data as DatabaseRow["schedule_rules"]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules", "schedule", site?.id] });
    },
  });
}

interface ToggleScheduleRuleInput {
  id: string;
  enabled: boolean;
}

export function useToggleScheduleRule() {
  const { site, user } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ToggleScheduleRuleInput) => {
      if (!site) throw new Error("No site selected");
      assertRulesWriteAccess(user?.role);

      const { error } = await supabase
        .from("schedule_rules")
        .update({ enabled: input.enabled } as never)
        .eq("id", input.id)
        .eq("site_id", site.id);

      if (error) throw error;

      await supabase.from("audit_log").insert({
        site_id: site.id,
        action: input.enabled ? "schedule_rule.enabled" : "schedule_rule.disabled",
        details: { ruleId: input.id },
        performed_by: user?.email ?? null,
      } as never);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules", "schedule", site?.id] });
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Substitution Rule Mutations                                       */
/* ------------------------------------------------------------------ */

export function useCreateSubstitutionRule() {
  const queryClient = useQueryClient();
  const { site, user } = useCurrentSite();

  return useMutation({
    mutationFn: async (input: SubstitutionRuleFormInput) => {
      if (!site) throw new Error("No site selected");
      assertRulesWriteAccess(user?.role);

      const validated = substitutionRuleFormSchema.parse(input);
      await assertResourcesBelongToSite(site.id, [
        validated.sourceResourceId,
        validated.targetResourceId,
      ]);

      const { data, error } = await supabase
        .from("substitution_rules")
        .insert({
          site_id: site.id,
          source_resource_id: validated.sourceResourceId,
          target_resource_id: validated.targetResourceId,
          conditions: (validated.conditions ?? null) as Json,
          enabled: validated.enabled,
          created_by: user?.email ?? null,
        } as never)
        .select()
        .single();

      if (error) throw error;

      await supabase.from("audit_log").insert({
        site_id: site.id,
        action: "substitution_rule.created",
        details: {
          sourceResourceId: validated.sourceResourceId,
          targetResourceId: validated.targetResourceId,
        },
        performed_by: user?.email ?? null,
      } as never);

      return mapSubstitutionRule(data as DatabaseRow["substitution_rules"]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules", "substitution", site?.id] });
    },
  });
}

export function useUpdateSubstitutionRule() {
  const queryClient = useQueryClient();
  const { site, user } = useCurrentSite();

  return useMutation({
    mutationFn: async ({ id, ...input }: SubstitutionRuleFormInput & { id: string }) => {
      if (!site) throw new Error("No site selected");
      assertRulesWriteAccess(user?.role);

      const validated = substitutionRuleFormSchema.parse(input);
      await assertResourcesBelongToSite(site.id, [
        validated.sourceResourceId,
        validated.targetResourceId,
      ]);

      const { data, error } = await supabase
        .from("substitution_rules")
        .update({
          source_resource_id: validated.sourceResourceId,
          target_resource_id: validated.targetResourceId,
          conditions: (validated.conditions ?? null) as Json,
          enabled: validated.enabled,
        } as never)
        .eq("id", id)
        .eq("site_id", site.id)
        .select()
        .single();

      if (error) throw error;

      await supabase.from("audit_log").insert({
        site_id: site.id,
        action: "substitution_rule.updated",
        details: {
          ruleId: id,
          sourceResourceId: validated.sourceResourceId,
          targetResourceId: validated.targetResourceId,
        },
        performed_by: user?.email ?? null,
      } as never);

      return mapSubstitutionRule(data as DatabaseRow["substitution_rules"]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules", "substitution", site?.id] });
    },
  });
}

export function useDeleteSubstitutionRule() {
  const queryClient = useQueryClient();
  const { site, user } = useCurrentSite();

  return useMutation({
    mutationFn: async (ruleId: string) => {
      if (!site) throw new Error("No site selected");
      assertRulesWriteAccess(user?.role);

      const { error } = await supabase
        .from("substitution_rules")
        .delete()
        .eq("id", ruleId)
        .eq("site_id", site.id);

      if (error) throw error;

      await supabase.from("audit_log").insert({
        site_id: site.id,
        action: "substitution_rule.deleted",
        details: { ruleId },
        performed_by: user?.email ?? null,
      } as never);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules", "substitution", site?.id] });
    },
  });
}

export function useToggleSubstitutionRule() {
  const queryClient = useQueryClient();
  const { site, user } = useCurrentSite();

  return useMutation({
    mutationFn: async (input: { id: string; enabled: boolean }) => {
      if (!site) throw new Error("No site selected");
      assertRulesWriteAccess(user?.role);

      const { error } = await supabase
        .from("substitution_rules")
        .update({ enabled: input.enabled } as never)
        .eq("id", input.id)
        .eq("site_id", site.id);

      if (error) throw error;

      await supabase.from("audit_log").insert({
        site_id: site.id,
        action: input.enabled ? "substitution_rule.enabled" : "substitution_rule.disabled",
        details: { ruleId: input.id },
        performed_by: user?.email ?? null,
      } as never);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules", "substitution", site?.id] });
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Substitution Generation Settings                                   */
/* ------------------------------------------------------------------ */

export interface SubstitutionGenerationSettingsRow {
  id: string;
  siteId: string;
  enabled: boolean;
  config: SubstitutionGenerationConfig;
  version: number;
  updatedBy: string | null;
  updatedAt: string;
  createdAt: string;
}

function mapGenerationSettings(
  row: DatabaseRow["substitution_generation_settings"],
): SubstitutionGenerationSettingsRow {
  const parsed = substitutionGenerationConfigSchema.safeParse(row.config);
  return {
    id: row.id,
    siteId: row.site_id,
    enabled: row.enabled,
    config: parsed.success ? parsed.data : DEFAULT_GENERATION_CONFIG,
    version: row.version,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

export function useSubstitutionGenerationSettings() {
  const { site } = useCurrentSite();

  return useQuery<SubstitutionGenerationSettingsRow | null>({
    queryKey: ["rules", "generation-settings", site?.id],
    queryFn: async () => {
      if (!site) return null;

      const { data, error } = await supabase
        .from("substitution_generation_settings")
        .select("*")
        .eq("site_id", site.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;
      return mapGenerationSettings(data as DatabaseRow["substitution_generation_settings"]);
    },
    enabled: !!site,
  });
}

export function useUpdateSubstitutionGenerationSettings() {
  const { site, user } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SubstitutionGenerationFormInput) => {
      if (!site) throw new Error("No site selected");
      assertRulesWriteAccess(user?.role);

      const validated = substitutionGenerationFormSchema.parse(input);

      // Upsert: try to find existing row for this site
      const { data: existing, error: lookupError } = await supabase
        .from("substitution_generation_settings")
        .select("id")
        .eq("site_id", site.id)
        .limit(1)
        .maybeSingle();

      if (lookupError) throw lookupError;

      let result: DatabaseRow["substitution_generation_settings"];

      if (existing) {
        const { data, error } = await supabase
          .from("substitution_generation_settings")
          .update({
            enabled: validated.enabled,
            config: validated.config as unknown as Json,
            version: GENERATION_SETTINGS_VERSION,
            updated_by: user?.email ?? null,
            updated_at: new Date().toISOString(),
          } as never)
          .eq("id", (existing as { id: string }).id)
          .eq("site_id", site.id)
          .select("*")
          .single();

        if (error) throw error;
        result = data as DatabaseRow["substitution_generation_settings"];
      } else {
        const { data, error } = await supabase
          .from("substitution_generation_settings")
          .insert({
            site_id: site.id,
            enabled: validated.enabled,
            config: validated.config as unknown as Json,
            version: GENERATION_SETTINGS_VERSION,
            updated_by: user?.email ?? null,
          } as never)
          .select("*")
          .single();

        if (error) throw error;
        result = data as DatabaseRow["substitution_generation_settings"];
      }

      const { error: auditError } = await supabase.from("audit_log").insert({
        site_id: site.id,
        action: "substitution_generation_settings.updated",
        details: {
          settingsId: result.id,
          enabled: validated.enabled,
          configSummary: {
            sameGroup: validated.config.scope.sameGroup,
            crossGroup: validated.config.scope.crossGroup,
            duplicatePolicy: validated.config.safety.duplicatePolicy,
          },
        },
        performed_by: user?.email ?? null,
      } as never);

      if (auditError) throw auditError;

      return mapGenerationSettings(result);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules", "generation-settings", site?.id] });
      toast.success("Generation settings saved");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to save generation settings");
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Bulk Create Substitution Rules                                     */
/* ------------------------------------------------------------------ */

export function useBulkCreateSubstitutionRules() {
  const queryClient = useQueryClient();
  const { site, user } = useCurrentSite();

  return useMutation({
    mutationFn: async (candidates: CandidateRule[]) => {
      if (!site) throw new Error("No site selected");
      assertRulesWriteAccess(user?.role);

      // Filter to only actionable candidates (not skipped)
      const toInsert = candidates.filter((c) => c.duplicateStatus !== "skipped");
      if (toInsert.length === 0) return [];

      // Validate all referenced resources belong to the current site
      const resourceIds = toInsert.flatMap((c) => [c.sourceResourceId, c.targetResourceId]);
      await assertResourcesBelongToSite(site.id, resourceIds);

      const rows = toInsert.map((c) => ({
        site_id: site.id,
        source_resource_id: c.sourceResourceId,
        target_resource_id: c.targetResourceId,
        conditions: (c.conditions ?? null) as Json,
        enabled: c.enabled,
        created_by: user?.email ?? null,
      }));

      const { data, error } = await supabase
        .from("substitution_rules")
        .insert(rows as never)
        .select("*");

      if (error) throw error;

      const { error: auditError } = await supabase.from("audit_log").insert({
        site_id: site.id,
        action: "substitution_rule.bulk_created",
        details: {
          count: (data as unknown[]).length,
          candidatesProvided: candidates.length,
          skipped: candidates.length - toInsert.length,
        },
        performed_by: user?.email ?? null,
      } as never);

      if (auditError) throw auditError;

      return ((data ?? []) as DatabaseRow["substitution_rules"][]).map(mapSubstitutionRule);
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["rules", "substitution", site?.id] });
      toast.success(`Created ${created.length} substitution rule${created.length === 1 ? "" : "s"}`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to create substitution rules");
    },
  });
}
