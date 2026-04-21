import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/ui/cn";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useUpdateBatch } from "@/hooks/use-batch-mutations";
import { useCurrentSite } from "@/hooks/use-current-site";
import { supabase } from "@/lib/supabase/client";
import { mapBatch } from "@/lib/utils/mappers";
import type { DatabaseRow } from "@/types/database";
import type { Batch } from "@/types/batch";
import type { Resource } from "@/types/resource";

const NEAR_STATUSES = ["Ready to Fill", "On Test", "In Progress"] as const;

interface JobSelectionDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trunkLine: string;
  trunkColor: string;
  resources: Resource[];
  planDate: string;
  currentBatchIds: Set<string>;
}

function useCandidateBatches(
  siteId: string | undefined,
  trunkResourceIds: string[],
  planDate: string,
  enabled: boolean,
) {
  return useQuery<Batch[]>({
    queryKey: ["filling-candidates", siteId, planDate, trunkResourceIds],
    enabled: enabled && !!siteId && trunkResourceIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      if (!siteId) return [];
      const { data, error } = await supabase
        .from("batches")
        .select("*")
        .eq("site_id", siteId)
        .in("status", NEAR_STATUSES)
        .in("plan_resource_id", trunkResourceIds)
        .order("plan_date", { ascending: true })
        .limit(100);
      if (error) throw error;
      return (data as DatabaseRow["batches"][]).map(mapBatch);
    },
  });
}

export function JobSelectionDrawer({
  open,
  onOpenChange,
  trunkLine,
  trunkColor,
  resources,
  planDate,
  currentBatchIds,
}: JobSelectionDrawerProps) {
  const [search, setSearch] = useState("");
  const { site } = useCurrentSite();
  const updateBatch = useUpdateBatch();

  // Resources belonging to this trunk
  const trunkResourceIds = useMemo(
    () => resources.filter((r) => r.trunkLine === trunkLine).map((r) => r.id),
    [resources, trunkLine],
  );

  const resourceMap = useMemo(
    () => new Map(resources.map((r) => [r.id, r])),
    [resources],
  );

  const { data: candidates = [], isLoading } = useCandidateBatches(
    site?.id,
    trunkResourceIds,
    planDate,
    open,
  );

  // Filter out batches already in the plan and apply search
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates.filter((b) => {
      if (currentBatchIds.has(b.id)) return false;
      if (!q) return true;
      return (
        b.sapOrder.toLowerCase().includes(q) ||
        (b.materialCode ?? "").toLowerCase().includes(q) ||
        (b.materialDescription ?? "").toLowerCase().includes(q)
      );
    });
  }, [candidates, currentBatchIds, search]);

  function handleAdd(batch: Batch) {
    updateBatch.mutate(
      { batchId: batch.id, updates: { planDate } },
      {
        onSuccess: () => {
          toast.success(`${batch.sapOrder} moved to ${format(new Date(planDate + "T00:00:00"), "d MMM")}`);
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : "Failed to move batch");
        },
      },
    );
  }

  const trunkNumber = trunkLine.replace("TK", "");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[380px] flex-col p-0 sm:max-w-[380px]">
        <SheetHeader className="border-b px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div
              className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-[6px] text-[13px] font-bold text-white"
              style={{ backgroundColor: trunkColor }}
            >
              T{trunkNumber}
            </div>
            <SheetTitle className="text-[14px]">Add job to Trunk {trunkNumber}</SheetTitle>
          </div>
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            Batches assigned to this trunk's mixers that aren't yet on today's plan.
          </p>
        </SheetHeader>

        {/* Search */}
        <div className="border-b px-4 py-2.5">
          <div className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search batch or material…"
              className="flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground/60"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="py-10 text-center text-[12.5px] text-muted-foreground">
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-[13px] font-medium text-foreground">No batches available</p>
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                {search ? "Try a different search." : "All eligible batches are already on this plan."}
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {filtered.map((batch) => {
                const res = batch.planResourceId ? resourceMap.get(batch.planResourceId) : null;
                const isPending = updateBatch.isPending && updateBatch.variables?.batchId === batch.id;
                return (
                  <li key={batch.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[13px] font-semibold tabular-nums text-foreground">
                          {batch.sapOrder}
                        </span>
                        <span className="text-[10px] text-border">·</span>
                        <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
                          {batch.materialCode ?? "—"}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-muted-foreground">
                        {res && (
                          <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono font-semibold text-foreground">
                            {res.displayName ?? res.resourceCode}
                          </span>
                        )}
                        {batch.planDate && batch.planDate !== planDate && (
                          <span className={cn(
                            "rounded px-1 py-0.5 text-[9.5px] font-medium",
                            "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
                            "dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800",
                          )}>
                            {format(new Date(batch.planDate + "T00:00:00"), "d MMM")}
                          </span>
                        )}
                        <span className="capitalize">{batch.status}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleAdd(batch)}
                      disabled={isPending}
                      className={cn(
                        "flex-shrink-0 rounded-md border px-2.5 py-1 text-[11.5px] font-medium transition",
                        "hover:bg-foreground hover:text-background",
                        isPending && "opacity-50 pointer-events-none",
                      )}
                    >
                      {isPending ? "Adding…" : "Add"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
