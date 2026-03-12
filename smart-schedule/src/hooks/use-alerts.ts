import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import { mapBulkAlert } from "@/lib/utils/mappers";
import type { DatabaseRow } from "@/types/database";
import type { BulkAlert } from "@/types/alert";
import type { BulkAlertFormInput } from "@/lib/validators/alert";

interface UseAlertsOptions {
  activeOnly?: boolean;
}

interface UpdateBulkAlertInput extends BulkAlertFormInput {
  id: string;
}

function isActiveAlert(alert: BulkAlert, todayISO: string): boolean {
  const startsOnOrBeforeToday = !alert.startDate || alert.startDate <= todayISO;
  const endsOnOrAfterToday = !alert.endDate || alert.endDate >= todayISO;
  return startsOnOrBeforeToday && endsOnOrAfterToday;
}

function assertAlertsWriteAccess(role?: string) {
  if (role !== "site_admin" && role !== "super_admin") {
    throw new Error("Only site admins can manage alerts");
  }
}

export function useAlerts(options: UseAlertsOptions = {}) {
  const { site } = useCurrentSite();
  const activeOnly = options.activeOnly ?? false;

  return useQuery<BulkAlert[]>({
    queryKey: ["alerts", site?.id, { activeOnly }],
    queryFn: async () => {
      if (!site) return [];

      const { data, error } = await supabase
        .from("bulk_alerts")
        .select("*")
        .eq("site_id", site.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      const mapped = (data as DatabaseRow["bulk_alerts"][]).map(mapBulkAlert);
      if (!activeOnly) return mapped;

      const todayISO = new Date().toISOString().slice(0, 10);
      return mapped.filter((alert) => isActiveAlert(alert, todayISO));
    },
    enabled: !!site,
  });
}

export function useActiveAlerts() {
  return useAlerts({ activeOnly: true });
}

export function useCreateAlert() {
  const { site, user } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: BulkAlertFormInput) => {
      if (!site) throw new Error("No site selected");
      if (!user) throw new Error("User context is required");
      assertAlertsWriteAccess(user?.role);

      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("bulk_alerts")
        .insert({
          site_id: site.id,
          batch_id: input.batchId ?? null,
          bulk_code: input.bulkCode ?? null,
          message: input.message,
          start_date: input.startDate ?? null,
          end_date: input.endDate ?? null,
          created_by: user?.id ?? null,
          created_at: now,
        } as never)
        .select("*")
        .single();

      if (error) throw error;

      const { error: adminActionError } = await supabase.from("admin_actions").insert({
        site_id: site.id,
        actor_user_id: user.id,
        action: "alert.created",
        target_type: "bulk_alert",
        target_id: (data as DatabaseRow["bulk_alerts"]).id,
        metadata: {
          batch_id: input.batchId ?? null,
          bulk_code: input.bulkCode ?? null,
          start_date: input.startDate ?? null,
          end_date: input.endDate ?? null,
          message: input.message,
        },
      } as never);
      if (adminActionError) throw adminActionError;

      return mapBulkAlert(data as DatabaseRow["bulk_alerts"]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });
}

export function useUpdateAlert() {
  const { site, user } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateBulkAlertInput) => {
      if (!site) throw new Error("No site selected");
      if (!user) throw new Error("User context is required");
      assertAlertsWriteAccess(user?.role);

      const { id, ...payload } = input;
      const { data, error } = await supabase
        .from("bulk_alerts")
        .update({
          batch_id: payload.batchId ?? null,
          bulk_code: payload.bulkCode ?? null,
          message: payload.message,
          start_date: payload.startDate ?? null,
          end_date: payload.endDate ?? null,
        } as never)
        .eq("id", id)
        .eq("site_id", site.id)
        .select("*")
        .single();

      if (error) throw error;

      const { error: adminActionError } = await supabase.from("admin_actions").insert({
        site_id: site.id,
        actor_user_id: user.id,
        action: "alert.updated",
        target_type: "bulk_alert",
        target_id: id,
        metadata: {
          batch_id: payload.batchId ?? null,
          bulk_code: payload.bulkCode ?? null,
          start_date: payload.startDate ?? null,
          end_date: payload.endDate ?? null,
          message: payload.message,
        },
      } as never);
      if (adminActionError) throw adminActionError;

      return mapBulkAlert(data as DatabaseRow["bulk_alerts"]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });
}

export function useDeleteAlert() {
  const { site, user } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!site) throw new Error("No site selected");
      if (!user) throw new Error("User context is required");
      assertAlertsWriteAccess(user?.role);

      const { error } = await supabase
        .from("bulk_alerts")
        .delete()
        .eq("id", id)
        .eq("site_id", site.id);
      if (error) throw error;

      const { error: adminActionError } = await supabase.from("admin_actions").insert({
        site_id: site.id,
        actor_user_id: user.id,
        action: "alert.deleted",
        target_type: "bulk_alert",
        target_id: id,
        metadata: {},
      } as never);
      if (adminActionError) throw adminActionError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });
}
