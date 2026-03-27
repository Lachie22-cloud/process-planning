import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import { usePermissions } from "./use-permissions";
import { mapMaterialShortage, mapBatchMaterialShortage } from "@/lib/utils/mappers";
import type { MaterialShortage, BatchMaterialShortage } from "@/types/material-shortage";

/** Fetch all material shortages for the current site */
export function useMaterialShortages() {
  const { site } = useCurrentSite();

  return useQuery<MaterialShortage[]>({
    queryKey: ["material_shortages", site?.id],
    queryFn: async () => {
      if (!site) return [];
      const { data, error } = await supabase
        .from("material_shortages")
        .select("*")
        .eq("site_id", site.id)
        .order("short_qty", { ascending: true }); // Most short first (negative values)
      if (error) throw error;
      return (data ?? []).map((r) => mapMaterialShortage(r as never));
    },
    enabled: !!site,
  });
}

/** Fetch batch-level shortages for a specific batch */
export function useBatchShortages(batchId: string | null) {
  const { site } = useCurrentSite();

  return useQuery<(BatchMaterialShortage & { shortage: MaterialShortage })[]>({
    queryKey: ["batch_material_shortages", batchId],
    queryFn: async () => {
      if (!site || !batchId) return [];
      const { data, error } = await supabase
        .from("batch_material_shortages")
        .select("*, material_shortages(*)")
        .eq("batch_id", batchId)
        .eq("site_id", site.id);
      if (error) throw error;
      return (data ?? []).map((r: Record<string, unknown>) => ({
        ...mapBatchMaterialShortage(r as never),
        shortage: mapMaterialShortage((r as Record<string, unknown>).material_shortages as never),
      }));
    },
    enabled: !!site && !!batchId,
  });
}

/** Update the ETA (next delivery date) for a material shortage */
export function useUpdateShortageEta() {
  const { site, user } = useCurrentSite();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ shortageId, eta }: { shortageId: string; eta: string | null }) => {
      if (!site) throw new Error("No site selected");
      if (!hasPermission("planning.vet")) {
        throw new Error("You do not have permission to update shortage ETA");
      }

      const now = new Date().toISOString();
      const { error } = await supabase
        .from("material_shortages")
        .update({ eta, updated_at: now } as never)
        .eq("id", shortageId)
        .eq("site_id", site.id);
      if (error) throw error;

      // Audit trail
      await supabase.from("audit_log").insert({
        site_id: site.id,
        action: "material_shortage.eta_updated",
        details: { shortageId, eta },
        performed_by: user?.id ?? null,
        performed_at: now,
      } as never);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["material_shortages"] });
    },
  });
}

/** Planner override for a material shortage (site-level) */
export function useOverrideMaterialShortage() {
  const { site, user } = useCurrentSite();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      shortageId,
      override,
      comment,
    }: {
      shortageId: string;
      override: boolean;
      comment: string;
    }) => {
      if (!site) throw new Error("No site selected");
      if (!hasPermission("planning.vet")) {
        throw new Error("Only planners can override material shortages");
      }
      if (override && !comment.trim()) {
        throw new Error("A comment is required when overriding a shortage (confirm SOH check or stock in transit)");
      }

      const now = new Date().toISOString();
      const { error } = await supabase
        .from("material_shortages")
        .update({
          planner_override: override,
          override_by: override ? (user?.id ?? null) : null,
          override_at: override ? now : null,
          override_comment: override ? comment.trim() : null,
          updated_at: now,
        } as never)
        .eq("id", shortageId)
        .eq("site_id", site.id);
      if (error) throw error;

      await supabase.from("audit_log").insert({
        site_id: site.id,
        action: override ? "material_shortage.planner_override" : "material_shortage.override_reverted",
        details: {
          shortageId,
          override,
          comment: comment.trim() || null,
          confirmedSohCheck: override,
        },
        performed_by: user?.id ?? null,
        performed_at: now,
      } as never);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["material_shortages"] });
      queryClient.invalidateQueries({ queryKey: ["batch_material_shortages"] });
      queryClient.invalidateQueries({ queryKey: ["batches"] });
    },
  });
}

/** Planner override for a batch-specific shortage */
export function useOverrideBatchShortage() {
  const { site, user } = useCurrentSite();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      batchShortageId,
      batchId,
      override,
      comment,
    }: {
      batchShortageId: string;
      batchId: string;
      override: boolean;
      comment: string;
    }) => {
      if (!site) throw new Error("No site selected");
      if (!hasPermission("planning.vet")) {
        throw new Error("Only planners can override batch shortages");
      }
      if (override && !comment.trim()) {
        throw new Error("A comment is required when overriding (confirm SOH check or stock in transit)");
      }

      const now = new Date().toISOString();
      const { error } = await supabase
        .from("batch_material_shortages")
        .update({
          planner_override: override,
          override_by: override ? (user?.id ?? null) : null,
          override_at: override ? now : null,
          override_comment: override ? comment.trim() : null,
        } as never)
        .eq("id", batchShortageId)
        .eq("site_id", site.id);
      if (error) throw error;

      await supabase.from("audit_log").insert({
        site_id: site.id,
        batch_id: batchId,
        action: override ? "batch_shortage.planner_override" : "batch_shortage.override_reverted",
        details: {
          batchShortageId,
          override,
          comment: comment.trim() || null,
          confirmedSohCheck: override,
        },
        performed_by: user?.id ?? null,
        performed_at: now,
      } as never);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["batch_material_shortages"] });
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      queryClient.invalidateQueries({ queryKey: ["material_shortages"] });
    },
  });
}

export interface BatchShortageRow {
  /** batch_material_shortages id */
  id: string;
  shortageId: string;
  batchId: string;
  siteId: string;
  shortQty: number;
  requiredQty: number;
  plannerOverride: boolean;
  overrideBy: string | null;
  overrideAt: string | null;
  overrideComment: string | null;
  // from material_shortages
  materialCode: string;
  materialDesc: string | null;
  materialType: "RM" | "PKG";
  uom: string;
  eta: string | null;
  shortageOverride: boolean;
  // from batches
  sapOrder: string;
  bulkCode: string | null;
  materialDescription: string | null;
  planDate: string | null;
  // fill order (PKG only — first linked fill order for this batch)
  fillOrder: string | null;
}

/** Fetch all batch-level shortages for the current site, with batch + material details */
export function useAllBatchShortages() {
  const { site } = useCurrentSite();

  return useQuery<BatchShortageRow[]>({
    queryKey: ["all_batch_material_shortages", site?.id],
    queryFn: async () => {
      if (!site) return [];
      const { data, error } = await supabase
        .from("batch_material_shortages")
        .select(
          "*, material_shortages(*), batches(sap_order, bulk_code, material_description, plan_date), linked_fill_orders(fill_order)",
        )
        .eq("site_id", site.id)
        .lt("short_qty", 0)
        .order("short_qty", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r: Record<string, unknown>) => {
        const ms = r.material_shortages as Record<string, unknown>;
        const b = r.batches as Record<string, unknown> | null;
        const fills = r.linked_fill_orders as Array<Record<string, unknown>> | null;
        return {
          id: r.id as string,
          shortageId: r.shortage_id as string,
          batchId: r.batch_id as string,
          siteId: r.site_id as string,
          shortQty: r.short_qty as number,
          requiredQty: (r.required_qty as number) ?? 0,
          plannerOverride: r.planner_override as boolean,
          overrideBy: (r.override_by as string | null) ?? null,
          overrideAt: (r.override_at as string | null) ?? null,
          overrideComment: (r.override_comment as string | null) ?? null,
          materialCode: ms?.material_code as string,
          materialDesc: (ms?.material_desc as string | null) ?? null,
          materialType: ms?.material_type as "RM" | "PKG",
          uom: ms?.uom as string,
          eta: (ms?.eta as string | null) ?? null,
          shortageOverride: (ms?.planner_override as boolean) ?? false,
          sapOrder: b?.sap_order as string,
          bulkCode: (b?.bulk_code as string | null) ?? null,
          materialDescription: (b?.material_description as string | null) ?? null,
          planDate: (b?.plan_date as string | null) ?? null,
          fillOrder: fills && fills.length > 0 ? ((fills[0].fill_order as string | null) ?? null) : null,
        };
      });
    },
    enabled: !!site,
  });
}

/** Upsert material shortages from import data */
export function useUpsertMaterialShortages() {
  const { site } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      shortages: Array<{
        materialCode: string;
        materialDesc: string | null;
        materialType: "RM" | "PKG";
        requiredQty: number;
        sohQty: number;
        shortQty: number;
        uom: string;
      }>,
    ) => {
      if (!site) throw new Error("No site selected");
      if (shortages.length === 0) return;

      const rows = shortages.map((s) => ({
        site_id: site.id,
        material_code: s.materialCode,
        material_desc: s.materialDesc,
        material_type: s.materialType,
        required_qty: s.requiredQty,
        soh_qty: s.sohQty,
        short_qty: s.shortQty,
        uom: s.uom,
        updated_at: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from("material_shortages")
        .upsert(rows as never, {
          onConflict: "site_id,material_code",
          ignoreDuplicates: false,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["material_shortages"] });
    },
  });
}

/** Upsert batch-material shortage links */
export function useUpsertBatchShortages() {
  const { site } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      links: Array<{
        batchId: string;
        shortageId: string;
        shortQty: number;
      }>,
    ) => {
      if (!site) throw new Error("No site selected");
      if (links.length === 0) return;

      const rows = links.map((l) => ({
        site_id: site.id,
        batch_id: l.batchId,
        shortage_id: l.shortageId,
        short_qty: l.shortQty,
      }));

      const { error } = await supabase
        .from("batch_material_shortages")
        .upsert(rows as never, {
          onConflict: "batch_id,shortage_id",
          ignoreDuplicates: false,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["batch_material_shortages"] });
    },
  });
}
