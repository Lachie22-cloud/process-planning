import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { mapSite } from "@/lib/utils/mappers";
import { useCurrentSite } from "./use-current-site";
import type { DatabaseRow } from "@/types/database";
import type { Site } from "@/types/site";
import type { SiteFormInput } from "@/lib/validators/site";

/** Fetch all sites (super-admin view) */
export function useSites() {
  return useQuery<Site[]>({
    queryKey: ["sites"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sites")
        .select("*")
        .order("name", { ascending: true });

      if (error) throw error;
      return (data as DatabaseRow["sites"][]).map(mapSite);
    },
  });
}

/** Create a new site */
export function useCreateSite() {
  const queryClient = useQueryClient();
  const { user } = useCurrentSite();

  return useMutation({
    mutationFn: async (input: SiteFormInput) => {
      if (!user || user.role !== "super_admin") {
        throw new Error("Only super admins can manage sites");
      }

      const { data, error } = await supabase
        .from("sites")
        .insert({
          name: input.name.trim(),
          code: input.code.trim(),
          timezone: input.timezone.trim(),
          week_end_day: input.weekEndDay,
          schedule_horizon: input.scheduleHorizon,
          active: input.active,
        } as never)
        .select()
        .single();

      if (error) throw error;

      const { error: adminActionError } = await supabase.from("admin_actions").insert({
        site_id: (data as DatabaseRow["sites"]).id,
        actor_user_id: user.id,
        action: "site.create",
        target_type: "site",
        target_id: (data as DatabaseRow["sites"]).id,
        metadata: { name: input.name, code: input.code, active: input.active },
      } as never);

      if (adminActionError) throw adminActionError;

      return mapSite(data as DatabaseRow["sites"]);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
  });
}

/** Update an existing site */
export function useUpdateSite() {
  const queryClient = useQueryClient();
  const { user } = useCurrentSite();

  return useMutation({
    mutationFn: async ({ id, ...input }: SiteFormInput & { id: string }) => {
      if (!user || user.role !== "super_admin") {
        throw new Error("Only super admins can manage sites");
      }

      const { data, error } = await supabase
        .from("sites")
        .update({
          name: input.name.trim(),
          code: input.code.trim(),
          timezone: input.timezone.trim(),
          week_end_day: input.weekEndDay,
          schedule_horizon: input.scheduleHorizon,
          active: input.active,
        } as never)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      const { error: adminActionError } = await supabase.from("admin_actions").insert({
        site_id: id,
        actor_user_id: user.id,
        action: "site.update",
        target_type: "site",
        target_id: id,
        metadata: { name: input.name, code: input.code, active: input.active },
      } as never);

      if (adminActionError) throw adminActionError;

      return mapSite(data as DatabaseRow["sites"]);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
  });
}

/** Deactivate (soft-delete) a site */
export function useDeactivateSite() {
  const queryClient = useQueryClient();
  const { user } = useCurrentSite();

  return useMutation({
    mutationFn: async (siteId: string) => {
      if (!user || user.role !== "super_admin") {
        throw new Error("Only super admins can manage sites");
      }

      const { error } = await supabase
        .from("sites")
        .update({ active: false } as never)
        .eq("id", siteId);

      if (error) throw error;

      const { error: adminActionError } = await supabase.from("admin_actions").insert({
        site_id: siteId,
        actor_user_id: user.id,
        action: "site.deactivate",
        target_type: "site",
        target_id: siteId,
        metadata: { active: false },
      } as never);

      if (adminActionError) throw adminActionError;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
  });
}

/** Permanently delete a site */
export function useDeleteSite() {
  const queryClient = useQueryClient();
  const { user } = useCurrentSite();

  return useMutation({
    mutationFn: async (siteId: string) => {
      if (!user || user.role !== "super_admin") {
        throw new Error("Only super admins can delete sites");
      }

      const { error: adminActionError } = await supabase.from("admin_actions").insert({
        site_id: siteId,
        actor_user_id: user.id,
        action: "site.delete",
        target_type: "site",
        target_id: siteId,
        metadata: {},
      } as never);

      if (adminActionError) throw adminActionError;

      const { error } = await supabase
        .from("sites")
        .delete()
        .eq("id", siteId);

      if (error) throw error;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
  });
}
