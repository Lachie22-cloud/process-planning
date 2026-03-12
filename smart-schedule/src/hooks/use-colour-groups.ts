import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import type { DatabaseRow } from "@/types/database";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ColourGroup {
  id: string;
  siteId: string;
  code: string;
  name: string;
  hexColour: string;
  sortOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ColourTransition {
  id: string;
  siteId: string;
  fromGroupId: string;
  toGroupId: string;
  allowed: boolean;
  requiresWashout: boolean;
  washoutMinutes: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/*  Mappers                                                            */
/* ------------------------------------------------------------------ */

function mapColourGroup(row: DatabaseRow["colour_groups"]): ColourGroup {
  return {
    id: row.id,
    siteId: row.site_id,
    code: row.code,
    name: row.name,
    hexColour: row.hex_colour,
    sortOrder: row.sort_order,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapColourTransition(row: DatabaseRow["colour_transitions"]): ColourTransition {
  return {
    id: row.id,
    siteId: row.site_id,
    fromGroupId: row.from_group_id,
    toGroupId: row.to_group_id,
    allowed: row.allowed,
    requiresWashout: row.requires_washout,
    washoutMinutes: row.washout_minutes,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ------------------------------------------------------------------ */
/*  Queries                                                            */
/* ------------------------------------------------------------------ */

export function useColourGroups() {
  const { site } = useCurrentSite();

  return useQuery<ColourGroup[]>({
    queryKey: ["colour-groups", site?.id],
    queryFn: async () => {
      if (!site) return [];

      const { data, error } = await supabase
        .from("colour_groups")
        .select("*")
        .eq("site_id", site.id)
        .order("sort_order", { ascending: true });

      if (error) throw error;
      return (data as DatabaseRow["colour_groups"][]).map(mapColourGroup);
    },
    enabled: !!site,
  });
}

export function useColourTransitions() {
  const { site } = useCurrentSite();

  return useQuery<ColourTransition[]>({
    queryKey: ["colour-transitions", site?.id],
    queryFn: async () => {
      if (!site) return [];

      const { data, error } = await supabase
        .from("colour_transitions")
        .select("*")
        .eq("site_id", site.id);

      if (error) throw error;
      return (data as DatabaseRow["colour_transitions"][]).map(mapColourTransition);
    },
    enabled: !!site,
  });
}

/* ------------------------------------------------------------------ */
/*  Colour Group Mutations                                             */
/* ------------------------------------------------------------------ */

interface ColourGroupInput {
  code: string;
  name: string;
  hexColour: string;
  sortOrder: number;
  active: boolean;
}

export function useCreateColourGroup() {
  const queryClient = useQueryClient();
  const { site } = useCurrentSite();

  return useMutation({
    mutationFn: async (input: ColourGroupInput) => {
      if (!site) throw new Error("No site selected");

      const { data, error } = await supabase
        .from("colour_groups")
        .insert({
          site_id: site.id,
          code: input.code.trim().toUpperCase(),
          name: input.name.trim(),
          hex_colour: input.hexColour,
          sort_order: input.sortOrder,
          active: input.active,
        } as never)
        .select()
        .single();

      if (error) throw error;
      return mapColourGroup(data as DatabaseRow["colour_groups"]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["colour-groups", site?.id] });
      toast.success("Colour group created");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to create colour group");
    },
  });
}

export function useUpdateColourGroup() {
  const queryClient = useQueryClient();
  const { site } = useCurrentSite();

  return useMutation({
    mutationFn: async ({ id, ...input }: ColourGroupInput & { id: string }) => {
      if (!site) throw new Error("No site selected");

      const { data, error } = await supabase
        .from("colour_groups")
        .update({
          code: input.code.trim().toUpperCase(),
          name: input.name.trim(),
          hex_colour: input.hexColour,
          sort_order: input.sortOrder,
          active: input.active,
        } as never)
        .eq("id", id)
        .eq("site_id", site.id)
        .select()
        .single();

      if (error) throw error;
      return mapColourGroup(data as DatabaseRow["colour_groups"]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["colour-groups", site?.id] });
      toast.success("Colour group updated");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to update colour group");
    },
  });
}

export function useDeleteColourGroup() {
  const queryClient = useQueryClient();
  const { site } = useCurrentSite();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!site) throw new Error("No site selected");

      const { error } = await supabase
        .from("colour_groups")
        .delete()
        .eq("id", id)
        .eq("site_id", site.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["colour-groups", site?.id] });
      queryClient.invalidateQueries({ queryKey: ["colour-transitions", site?.id] });
      toast.success("Colour group deleted");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to delete colour group");
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Colour Transition Mutations                                        */
/* ------------------------------------------------------------------ */

interface ColourTransitionInput {
  fromGroupId: string;
  toGroupId: string;
  allowed: boolean;
  requiresWashout: boolean;
  washoutMinutes: number | null;
  notes: string | null;
}

export function useUpsertColourTransition() {
  const queryClient = useQueryClient();
  const { site } = useCurrentSite();

  return useMutation({
    mutationFn: async (input: ColourTransitionInput) => {
      if (!site) throw new Error("No site selected");

      const { data, error } = await supabase
        .from("colour_transitions")
        .upsert(
          {
            site_id: site.id,
            from_group_id: input.fromGroupId,
            to_group_id: input.toGroupId,
            allowed: input.allowed,
            requires_washout: input.requiresWashout,
            washout_minutes: input.washoutMinutes,
            notes: input.notes,
          } as never,
          { onConflict: "site_id,from_group_id,to_group_id" },
        )
        .select()
        .single();

      if (error) throw error;
      return mapColourTransition(data as DatabaseRow["colour_transitions"]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["colour-transitions", site?.id] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to update transition");
    },
  });
}
