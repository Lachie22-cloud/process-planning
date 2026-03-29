import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import type { BatchStatus } from "@/types/batch";

interface UpdateBatchInput {
  batchId: string;
  updates: {
    status?: BatchStatus;
    statusComment?: string | null;
    planDate?: string | null;
    planResourceId?: string | null;
    qcObservedStage?: string | null;
    qcObservedAt?: string | null;
    qcObservedBy?: string | null;
    observationRequired?: boolean;
    ebrBatch?: boolean;
    physicalLocation?: string | null;
    excessPaintComment?: string | null;
    bulkOffComment?: string | null;
  };
}

interface AuditInput {
  batchId: string;
  action: string;
  details: Record<string, unknown>;
}

export function useUpdateBatch() {
  const { site, user } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ batchId, updates }: UpdateBatchInput) => {
      if (!site) throw new Error("No site selected");

      const dbUpdates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (updates.status !== undefined) dbUpdates.status = updates.status;
      if (updates.statusComment !== undefined)
        dbUpdates.status_comment = updates.statusComment;
      if (updates.planDate !== undefined) dbUpdates.plan_date = updates.planDate;
      if (updates.planResourceId !== undefined)
        dbUpdates.plan_resource_id = updates.planResourceId;
      if (updates.qcObservedStage !== undefined)
        dbUpdates.qc_observed_stage = updates.qcObservedStage;
      if (updates.qcObservedAt !== undefined)
        dbUpdates.qc_observed_at = updates.qcObservedAt;
      if (updates.qcObservedBy !== undefined)
        dbUpdates.qc_observed_by = updates.qcObservedBy;
      if (updates.observationRequired !== undefined)
        dbUpdates.observation_required = updates.observationRequired;
      if (updates.ebrBatch !== undefined)
        dbUpdates.ebr_batch = updates.ebrBatch;
      if (updates.physicalLocation !== undefined)
        dbUpdates.physical_location = updates.physicalLocation;
      if (updates.excessPaintComment !== undefined)
        dbUpdates.excess_paint_comment = updates.excessPaintComment;
      if (updates.bulkOffComment !== undefined)
        dbUpdates.bulk_off_comment = updates.bulkOffComment;

      if (updates.status !== undefined) {
        dbUpdates.status_changed_at = new Date().toISOString();
        dbUpdates.status_changed_by = user?.id ?? null;
      }

      const { error } = await supabase
        .from("batches")
        .update(dbUpdates as never)
        .eq("id", batchId)
        .eq("site_id", site.id);

      if (error) throw error;

      // When a batch reaches "Job Complete", clear OOS-locked coverage items
      if (updates.status === "Job Complete") {
        await supabase
          .from("batch_coverage_items")
          .delete()
          .eq("batch_id", batchId)
          .eq("oos_locked", true);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      queryClient.invalidateQueries({ queryKey: ["batch_coverage_items"] });
    },
  });
}

/** Bulk-assign plan_resource_id for multiple batches */
export function useBulkAssignResources() {
  const { site } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (assignments: Map<string, string>) => {
      if (!site) throw new Error("No site selected");

      let updated = 0;
      for (const [batchId, resourceId] of assignments) {
        const { error } = await supabase
          .from("batches")
          .update({ plan_resource_id: resourceId, updated_at: new Date().toISOString() } as never)
          .eq("id", batchId)
          .eq("site_id", site.id);
        if (error) throw error;
        updated++;
      }
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["batches"] });
    },
  });
}

export function useAddAuditEntry() {
  const { site, user } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ batchId, action, details }: AuditInput) => {
      if (!site) throw new Error("No site selected");

      const { error } = await supabase.from("audit_log").insert({
        site_id: site.id,
        batch_id: batchId,
        action,
        details,
        performed_by: user?.id ?? null,
        performed_at: new Date().toISOString(),
      } as never);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

/** Purge all batches and linked fill orders for the current site */
export function usePurgeSiteData() {
  const { site, user } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!site) throw new Error("No site selected");
      if (!user || (user.role !== "site_admin" && user.role !== "super_admin")) {
        throw new Error("Only site admins can purge data");
      }

      // Delete coverage items first (FK dependency)
      const { error: covErr } = await supabase
        .from("batch_coverage_items")
        .delete()
        .eq("site_id", site.id);
      if (covErr) throw covErr;

      // Delete linked fill orders (FK dependency)
      const { error: fillErr } = await supabase
        .from("linked_fill_orders")
        .delete()
        .eq("site_id", site.id);
      if (fillErr) throw fillErr;

      // Delete all batches
      const { error: batchErr } = await supabase
        .from("batches")
        .delete()
        .eq("site_id", site.id);
      if (batchErr) throw batchErr;

      // Log to audit
      await supabase.from("audit_log").insert({
        site_id: site.id,
        batch_id: null,
        action: "purge_site_data",
        details: { purged_by: user.email ?? user.id },
        performed_by: user.id,
        performed_at: new Date().toISOString(),
      } as never);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      queryClient.invalidateQueries({ queryKey: ["linked-fill-orders"] });
      queryClient.invalidateQueries({ queryKey: ["batch_coverage_items"] });
      toast.success("All batches and linked fill orders have been purged");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to purge data");
    },
  });
}
