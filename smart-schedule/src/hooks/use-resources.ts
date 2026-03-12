import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import { mapResource } from "@/lib/utils/mappers";
import type { DatabaseRow } from "@/types/database";
import type { Resource } from "@/types/resource";
import type { ResourceFormInput } from "@/lib/validators/resource";

/** Fetch all resources for the current site (includes inactive for admin view) */
export function useResources(includeInactive = false) {
  const { site } = useCurrentSite();

  return useQuery<Resource[]>({
    queryKey: ["resources", site?.id, includeInactive],
    queryFn: async () => {
      if (!site) return [];

      let query = supabase
        .from("resources")
        .select("*")
        .eq("site_id", site.id)
        .order("sort_order", { ascending: true });

      if (!includeInactive) {
        query = query.eq("active", true);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data as DatabaseRow["resources"][]).map(mapResource);
    },
    enabled: !!site,
  });
}

/** Create a new resource */
export function useCreateResource() {
  const queryClient = useQueryClient();
  const { site, user } = useCurrentSite();

  return useMutation({
    mutationFn: async (input: ResourceFormInput) => {
      if (!site) throw new Error("No site selected");
      if (!user || (user.role !== "site_admin" && user.role !== "super_admin")) {
        throw new Error("Only site admins can manage resources");
      }

      const { data, error } = await supabase
        .from("resources")
        .insert({
          site_id: site.id,
          resource_code: input.resourceCode.trim(),
          resource_type: input.resourceType,
          display_name: input.displayName?.trim() || null,
          trunk_line: input.trunkLine?.trim() || null,
          group_name: input.groupName?.trim() || null,
          min_capacity: input.minCapacity,
          max_capacity: input.maxCapacity,
          max_batches_per_day: input.maxBatchesPerDay,
          chemical_base: input.chemicalBase?.trim() || null,
          sort_order: input.sortOrder,
          active: input.active,
          config: {},
        } as never)
        .select()
        .single();

      if (error) throw error;

      const { error: adminActionError } = await supabase.from("admin_actions").insert({
        site_id: site.id,
        actor_user_id: user.id,
        action: "resource.create",
        target_type: "resource",
        target_id: (data as DatabaseRow["resources"]).id,
        metadata: {
          resourceCode: input.resourceCode,
          resourceType: input.resourceType,
          active: input.active,
        },
      } as never);

      if (adminActionError) throw adminActionError;

      return mapResource(data as DatabaseRow["resources"]);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["resources"] });
    },
  });
}

/** Update an existing resource */
export function useUpdateResource() {
  const queryClient = useQueryClient();
  const { site, user } = useCurrentSite();

  return useMutation({
    mutationFn: async ({ id, ...input }: ResourceFormInput & { id: string }) => {
      if (!site) throw new Error("No site selected");
      if (!user || (user.role !== "site_admin" && user.role !== "super_admin")) {
        throw new Error("Only site admins can manage resources");
      }

      const { data, error } = await supabase
        .from("resources")
        .update({
          resource_code: input.resourceCode.trim(),
          resource_type: input.resourceType,
          display_name: input.displayName?.trim() || null,
          trunk_line: input.trunkLine?.trim() || null,
          group_name: input.groupName?.trim() || null,
          min_capacity: input.minCapacity,
          max_capacity: input.maxCapacity,
          max_batches_per_day: input.maxBatchesPerDay,
          chemical_base: input.chemicalBase?.trim() || null,
          sort_order: input.sortOrder,
          active: input.active,
        } as never)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      const { error: adminActionError } = await supabase.from("admin_actions").insert({
        site_id: site.id,
        actor_user_id: user.id,
        action: "resource.update",
        target_type: "resource",
        target_id: id,
        metadata: {
          resourceId: id,
          resourceCode: input.resourceCode,
          active: input.active,
        },
      } as never);

      if (adminActionError) throw adminActionError;

      return mapResource(data as DatabaseRow["resources"]);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["resources"] });
    },
  });
}

/** Deactivate (soft-delete) a resource */
export function useDeactivateResource() {
  const queryClient = useQueryClient();
  const { site, user } = useCurrentSite();

  return useMutation({
    mutationFn: async (resourceId: string) => {
      if (!site) throw new Error("No site selected");
      if (!user || (user.role !== "site_admin" && user.role !== "super_admin")) {
        throw new Error("Only site admins can manage resources");
      }

      const { error } = await supabase
        .from("resources")
        .update({ active: false } as never)
        .eq("id", resourceId);

      if (error) throw error;

      const { error: adminActionError } = await supabase.from("admin_actions").insert({
        site_id: site.id,
        actor_user_id: user.id,
        action: "resource.deactivate",
        target_type: "resource",
        target_id: resourceId,
        metadata: { resourceId, active: false },
      } as never);

      if (adminActionError) throw adminActionError;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["resources"] });
    },
  });
}
