import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import type { DatabaseRow } from "@/types/database";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface AiScheduledTask {
  id: string;
  siteId: string;
  name: string;
  description: string | null;
  taskType: DatabaseRow["ai_scheduled_tasks"]["task_type"];
  cronExpression: string;
  timezone: string;
  misfirePolicy: DatabaseRow["ai_scheduled_tasks"]["misfire_policy"];
  lockTtlSeconds: number;
  retryMax: number;
  retryBackoffSeconds: number;
  customPrompt: string | null;
  notifyUserIds: string[];
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
  lastRunDurationMs: number | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapAiTask(row: DatabaseRow["ai_scheduled_tasks"]): AiScheduledTask {
  return {
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    description: row.description,
    taskType: row.task_type,
    cronExpression: row.cron_expression,
    timezone: row.timezone,
    misfirePolicy: row.misfire_policy,
    lockTtlSeconds: row.lock_ttl_seconds,
    retryMax: row.retry_max,
    retryBackoffSeconds: row.retry_backoff_seconds,
    customPrompt: row.custom_prompt,
    notifyUserIds: row.notify_user_ids ?? [],
    enabled: row.enabled,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    lastError: row.last_error,
    lastRunDurationMs: row.last_run_duration_ms,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ------------------------------------------------------------------ */
/*  Cron Validation                                                    */
/* ------------------------------------------------------------------ */

const CRON_FIELD_RANGES: Array<{ name: string; min: number; max: number }> = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day of week", min: 0, max: 7 },
];

function isValidCronValue(value: string, min: number, max: number): boolean {
  if (value === "*") return true;

  // Handle step values: */2, 1-5/2
  const stepMatch = value.match(/^(.+)\/(\d+)$/);
  if (stepMatch) {
    const base = stepMatch[1] as string;
    const step = parseInt(stepMatch[2] as string, 10);
    if (isNaN(step) || step < 1) return false;
    return isValidCronValue(base, min, max);
  }

  // Handle ranges: 1-5
  const rangeMatch = value.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1] as string, 10);
    const end = parseInt(rangeMatch[2] as string, 10);
    return start >= min && end <= max && start <= end;
  }

  // Handle single numbers
  const num = parseInt(value, 10);
  return !isNaN(num) && num >= min && num <= max;
}

export function validateCronExpression(expression: string): {
  valid: boolean;
  error?: string;
} {
  const trimmed = expression.trim();
  if (!trimmed) return { valid: false, error: "Cron expression is required" };

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    return {
      valid: false,
      error: `Expected 5 fields (minute hour dom month dow), got ${parts.length}`,
    };
  }

  for (let i = 0; i < 5; i++) {
    const field = parts[i]!;
    const range = CRON_FIELD_RANGES[i]!;

    // Split on commas for list values
    const values = field.split(",");
    for (const v of values) {
      if (!isValidCronValue(v, range.min, range.max)) {
        return {
          valid: false,
          error: `Invalid ${range.name} value: "${v}" (allowed: ${range.min}-${range.max})`,
        };
      }
    }
  }

  return { valid: true };
}

/** Human-readable description of common cron patterns */
export function describeCron(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return expression;

  const min = parts[0]!;
  const hour = parts[1]!;
  const dom = parts[2]!;
  const mon = parts[3]!;
  const dow = parts[4]!;

  if (min === "0" && hour === "0" && dom === "*" && mon === "*" && dow === "*")
    return "Daily at midnight";
  if (min === "0" && dom === "*" && mon === "*" && dow === "*")
    return `Daily at ${hour}:00`;
  if (min === "0" && hour === "0" && dom === "*" && mon === "*" && dow === "1")
    return "Weekly on Monday at midnight";
  if (dom === "*" && mon === "*" && dow === "*") return `Daily at ${hour}:${min.padStart(2, "0")}`;
  if (min === "0" && hour === "*" && dom === "*" && mon === "*" && dow === "*")
    return "Every hour";
  if (dom === "1" && mon === "*" && dow === "*")
    return `Monthly on the 1st at ${hour}:${min.padStart(2, "0")}`;

  return expression;
}

/* ------------------------------------------------------------------ */
/*  Queries                                                            */
/* ------------------------------------------------------------------ */

export function useAiScheduledTasks() {
  const { site } = useCurrentSite();

  return useQuery<AiScheduledTask[]>({
    queryKey: ["ai_scheduled_tasks", site?.id],
    queryFn: async () => {
      if (!site) return [];

      const { data, error } = await supabase
        .from("ai_scheduled_tasks")
        .select("*")
        .eq("site_id", site.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data as DatabaseRow["ai_scheduled_tasks"][]).map(mapAiTask);
    },
    enabled: !!site,
  });
}

/* ------------------------------------------------------------------ */
/*  Mutations                                                          */
/* ------------------------------------------------------------------ */

export interface AiTaskInput {
  name: string;
  description?: string | null;
  taskType: DatabaseRow["ai_scheduled_tasks"]["task_type"];
  cronExpression: string;
  timezone: string;
  misfirePolicy?: DatabaseRow["ai_scheduled_tasks"]["misfire_policy"];
  lockTtlSeconds?: number;
  retryMax?: number;
  retryBackoffSeconds?: number;
  customPrompt?: string | null;
  notifyUserIds?: string[];
  enabled?: boolean;
}

export function useCreateAiTask() {
  const { site, user } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: AiTaskInput) => {
      if (!site) throw new Error("No site selected");

      const cronResult = validateCronExpression(input.cronExpression);
      if (!cronResult.valid) throw new Error(cronResult.error);

      const { data, error } = await supabase
        .from("ai_scheduled_tasks")
        .insert({
          site_id: site.id,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          task_type: input.taskType,
          cron_expression: input.cronExpression.trim(),
          timezone: input.timezone,
          misfire_policy: input.misfirePolicy ?? "skip_if_missed",
          lock_ttl_seconds: input.lockTtlSeconds ?? 300,
          retry_max: input.retryMax ?? 3,
          retry_backoff_seconds: input.retryBackoffSeconds ?? 60,
          custom_prompt: input.customPrompt?.trim() || null,
          notify_user_ids: input.notifyUserIds ?? [],
          enabled: input.enabled ?? false,
          created_by: user?.id ?? null,
          updated_by: user?.id ?? null,
        } as never)
        .select("*")
        .single();

      if (error) throw error;

      await supabase.from("audit_log").insert({
        site_id: site.id,
        action: "ai_task.created",
        details: { name: input.name, taskType: input.taskType },
        performed_by: user?.email ?? null,
      } as never);

      return mapAiTask(data as DatabaseRow["ai_scheduled_tasks"]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai_scheduled_tasks", site?.id] });
      toast.success("Scheduled task created");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to create task");
    },
  });
}

export function useUpdateAiTask() {
  const { site, user } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...input }: AiTaskInput & { id: string }) => {
      if (!site) throw new Error("No site selected");

      const cronResult = validateCronExpression(input.cronExpression);
      if (!cronResult.valid) throw new Error(cronResult.error);

      const { data, error } = await supabase
        .from("ai_scheduled_tasks")
        .update({
          name: input.name.trim(),
          description: input.description?.trim() || null,
          task_type: input.taskType,
          cron_expression: input.cronExpression.trim(),
          timezone: input.timezone,
          misfire_policy: input.misfirePolicy ?? "skip_if_missed",
          lock_ttl_seconds: input.lockTtlSeconds ?? 300,
          retry_max: input.retryMax ?? 3,
          retry_backoff_seconds: input.retryBackoffSeconds ?? 60,
          custom_prompt: input.customPrompt?.trim() || null,
          notify_user_ids: input.notifyUserIds ?? [],
          enabled: input.enabled ?? false,
          updated_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", id)
        .eq("site_id", site.id)
        .select("*")
        .single();

      if (error) throw error;

      await supabase.from("audit_log").insert({
        site_id: site.id,
        action: "ai_task.updated",
        details: { taskId: id, name: input.name },
        performed_by: user?.email ?? null,
      } as never);

      return mapAiTask(data as DatabaseRow["ai_scheduled_tasks"]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai_scheduled_tasks", site?.id] });
      toast.success("Scheduled task updated");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to update task");
    },
  });
}

export function useDeleteAiTask() {
  const { site, user } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (taskId: string) => {
      if (!site) throw new Error("No site selected");

      const { error } = await supabase
        .from("ai_scheduled_tasks")
        .delete()
        .eq("id", taskId)
        .eq("site_id", site.id);

      if (error) throw error;

      await supabase.from("audit_log").insert({
        site_id: site.id,
        action: "ai_task.deleted",
        details: { taskId },
        performed_by: user?.email ?? null,
      } as never);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai_scheduled_tasks", site?.id] });
      toast.success("Scheduled task deleted");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to delete task");
    },
  });
}

export function useToggleAiTask() {
  const { site, user } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      if (!site) throw new Error("No site selected");

      const { error } = await supabase
        .from("ai_scheduled_tasks")
        .update({ enabled, updated_by: user?.id ?? null } as never)
        .eq("id", id)
        .eq("site_id", site.id);

      if (error) throw error;

      await supabase.from("audit_log").insert({
        site_id: site.id,
        action: enabled ? "ai_task.enabled" : "ai_task.disabled",
        details: { taskId: id },
        performed_by: user?.email ?? null,
      } as never);
    },
    onSuccess: (_, { enabled }) => {
      queryClient.invalidateQueries({ queryKey: ["ai_scheduled_tasks", site?.id] });
      toast.success(enabled ? "Task enabled" : "Task disabled");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to toggle task");
    },
  });
}

function getAiAgentUrl(): string {
  return (import.meta.env.VITE_AI_AGENT_URL as string | undefined) ?? "";
}

async function getAccessToken(): Promise<string> {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) throw new Error("Not authenticated");
  return session.access_token;
}

export function useRunAiTaskNow() {
  const { site } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (taskId: string) => {
      if (!site) throw new Error("No site selected");
      const token = await getAccessToken();

      const res = await fetch(`${getAiAgentUrl()}/ai/admin/tasks/${taskId}/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ siteId: site.id }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };

      if (!res.ok) {
        throw new Error(payload.error ?? `Failed to run task (${res.status})`);
      }

      return payload;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai_scheduled_tasks", site?.id] });
      toast.success("Task run started");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to run task");
    },
  });
}
