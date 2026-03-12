import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import { usePermissions } from "./use-permissions";
import type { VettingStatus } from "@/types/batch";

/** Canonical transition rules — also used by vetting-status-badge.tsx for UI gating */
export const ALLOWED_TRANSITIONS: Record<VettingStatus, VettingStatus[]> = {
  pending: ["approved", "rejected", "not_required"],
  approved: ["pending", "rejected"],
  rejected: ["pending", "approved"],
  not_required: ["pending"],
};

function isTransitionAllowed(from: VettingStatus, to: VettingStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

interface VetBatchInput {
  batchId: string;
  vettingStatus: VettingStatus;
  vettingComment?: string | null;
}

interface BulkVetInput {
  batchIds: string[];
  vettingStatus: VettingStatus;
  vettingComment?: string | null;
}

interface ManualShortageOverrideInput {
  batchId: string;
  overrideComment?: string | null;
}

export function useVetBatch() {
  const { site, user } = useCurrentSite();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ batchId, vettingStatus, vettingComment }: VetBatchInput) => {
      if (!site) throw new Error("No site selected");
      if (!hasPermission("planning.vet")) {
        throw new Error("You do not have permission to vet batches");
      }

      // Enforce: comment required when rejecting
      if (vettingStatus === "rejected" && !vettingComment?.trim()) {
        throw new Error("A comment is required when rejecting a batch");
      }

      // Read current batch to validate transition
      const { data: currentBatchRaw, error: fetchError } = await supabase
        .from("batches")
        .select("vetting_status, vetting_comment")
        .eq("id", batchId)
        .eq("site_id", site.id)
        .single();

      if (fetchError) throw fetchError;
      if (!currentBatchRaw) throw new Error("Batch not found");

      const currentBatch = currentBatchRaw as unknown as {
        vetting_status: string;
        vetting_comment: string | null;
      };
      const fromStatus = currentBatch.vetting_status as VettingStatus;

      // Skip no-op: same status requested
      if (fromStatus === vettingStatus) return;

      // Validate transition
      if (!isTransitionAllowed(fromStatus, vettingStatus)) {
        throw new Error(
          `Invalid transition: cannot move from "${fromStatus}" to "${vettingStatus}"`,
        );
      }

      const now = new Date().toISOString();

      // Update the batch vetting fields
      const { error: updateError } = await supabase
        .from("batches")
        .update({
          vetting_status: vettingStatus,
          vetted_by: user?.id ?? null,
          vetted_at: now,
          vetting_comment: vettingComment ?? null,
          updated_at: now,
        } as never)
        .eq("id", batchId)
        .eq("site_id", site.id);

      if (updateError) throw updateError;

      // Create audit entry with before/after status
      const { error: auditError } = await supabase.from("audit_log").insert({
        site_id: site.id,
        batch_id: batchId,
        action: `vetting.${vettingStatus}`,
        details: {
          fromStatus,
          toStatus: vettingStatus,
          previousComment: (currentBatch.vetting_comment as string | null) ?? null,
          vettingComment: vettingComment ?? null,
        },
        performed_by: user?.id ?? null,
        performed_at: now,
      } as never);

      if (auditError) throw auditError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

export function useBulkVet() {
  const { site, user } = useCurrentSite();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ batchIds, vettingStatus, vettingComment }: BulkVetInput) => {
      if (!site) throw new Error("No site selected");
      if (!hasPermission("planning.vet")) {
        throw new Error("You do not have permission to vet batches");
      }

      // Enforce: comment required when rejecting
      if (vettingStatus === "rejected" && !vettingComment?.trim()) {
        throw new Error("A comment is required when rejecting batches");
      }

      // Read current batch statuses to validate transitions
      const { data: currentBatchesRaw, error: fetchError } = await supabase
        .from("batches")
        .select("id, vetting_status, vetting_comment")
        .in("id", batchIds)
        .eq("site_id", site.id);

      if (fetchError) throw fetchError;
      if (!currentBatchesRaw || currentBatchesRaw.length === 0) {
        throw new Error("No batches found");
      }

      const currentBatches = currentBatchesRaw as unknown as Array<{
        id: string;
        vetting_status: string;
        vetting_comment: string | null;
      }>;

      // Filter out no-ops (already at target status) and validate transitions
      const validBatches: Array<{
        id: string;
        fromStatus: VettingStatus;
        previousComment: string | null;
      }> = [];

      for (const batch of currentBatches) {
        const fromStatus = batch.vetting_status as VettingStatus;
        if (fromStatus === vettingStatus) continue; // Skip no-op
        if (!isTransitionAllowed(fromStatus, vettingStatus)) {
          throw new Error(
            `Invalid transition for batch ${batch.id}: cannot move from "${fromStatus}" to "${vettingStatus}"`,
          );
        }
        validBatches.push({
          id: batch.id,
          fromStatus,
          previousComment: batch.vetting_comment ?? null,
        });
      }

      // Nothing to update
      if (validBatches.length === 0) return;

      const now = new Date().toISOString();
      const validIds = validBatches.map((b) => b.id);

      // Bulk update only valid batches
      const { error: updateError } = await supabase
        .from("batches")
        .update({
          vetting_status: vettingStatus,
          vetted_by: user?.id ?? null,
          vetted_at: now,
          vetting_comment: vettingComment ?? null,
          updated_at: now,
        } as never)
        .in("id", validIds)
        .eq("site_id", site.id);

      if (updateError) throw updateError;

      // Create audit entries with before/after status for each batch
      const auditRows = validBatches.map((batch) => ({
        site_id: site.id,
        batch_id: batch.id,
        action: `vetting.${vettingStatus}`,
        details: {
          fromStatus: batch.fromStatus,
          toStatus: vettingStatus,
          previousComment: batch.previousComment,
          vettingComment: vettingComment ?? null,
          bulkAction: true,
          batchCount: validBatches.length,
        },
        performed_by: user?.id ?? null,
        performed_at: now,
      }));

      const { error: auditError } = await supabase
        .from("audit_log")
        .insert(auditRows as never);

      if (auditError) throw auditError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

export function useManualShortageOverride() {
  const { site, user } = useCurrentSite();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ batchId, overrideComment }: ManualShortageOverrideInput) => {
      if (!site) throw new Error("No site selected");
      if (!hasPermission("planning.vet")) {
        throw new Error("You do not have permission to override shortages");
      }

      const { data: currentBatchRaw, error: fetchError } = await supabase
        .from("batches")
        .select("material_shortage")
        .eq("id", batchId)
        .eq("site_id", site.id)
        .single();

      if (fetchError) throw fetchError;
      if (!currentBatchRaw) throw new Error("Batch not found");

      const currentBatch = currentBatchRaw as unknown as {
        material_shortage: boolean;
      };

      if (!currentBatch.material_shortage) return;

      const now = new Date().toISOString();

      const { error: updateError } = await supabase
        .from("batches")
        .update({
          material_shortage: false,
          updated_at: now,
        } as never)
        .eq("id", batchId)
        .eq("site_id", site.id);

      if (updateError) throw updateError;

      const { error: auditError } = await supabase.from("audit_log").insert({
        site_id: site.id,
        batch_id: batchId,
        action: "material_shortage.manual_override",
        details: {
          fromShortage: true,
          toShortage: false,
          confirmedManualSohCheck: true,
          overrideComment: overrideComment ?? null,
        },
        performed_by: user?.id ?? null,
        performed_at: now,
      } as never);

      if (auditError) throw auditError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}
