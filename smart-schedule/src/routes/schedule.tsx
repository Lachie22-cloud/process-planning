import { useState, useMemo, useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { WeekSelector } from "@/components/schedule/week-selector";
import { FilterBar, type FilterState } from "@/components/schedule/filter-bar";
import { SummaryCards } from "@/components/schedule/summary-cards";
import { BatchTable } from "@/components/schedule/batch-table";
import { BatchDetailSheet } from "@/components/schedule/batch-detail-sheet";
import { AlertManager } from "@/components/alerts/alert-manager";
import { PermissionGate } from "@/components/shared/permission-gate";
import { Button } from "@/components/ui/button";
import { useWeek } from "@/hooks/use-week";
import { useBatches } from "@/hooks/use-batches";
import { useResources } from "@/hooks/use-resources";
import { usePermissions } from "@/hooks/use-permissions";
import { exportBatchesCsv, exportBatchDateExport } from "@/lib/utils/csv-export";
import type { Batch } from "@/types/batch";

export function SchedulePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const week = useWeek();
  const { data: resources = [], isLoading: resourcesLoading } = useResources();
  const { hasPermission } = usePermissions();
  const deepLinkBatchId = searchParams.get("batchId");

  const [filters, setFilters] = useState<FilterState>({
    search: "",
    status: "all",
    resourceGroup: "all",
  });

  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const weekStartStr = useMemo(
    () => format(week.weekStart, "yyyy-MM-dd"),
    [week.weekStart],
  );

  const { data: batches = [], isLoading: batchesLoading } = useBatches({
    weekStart: weekStartStr,
    weekEnding: week.weekEndingStr,
  });

  // Client-side filtering for search, status, and resource group
  const filteredBatches = useMemo(() => {
    return batches.filter((batch) => {
      // Text search
      if (filters.search) {
        const term = filters.search.toLowerCase();
        const matchesSearch =
          batch.sapOrder.toLowerCase().includes(term) ||
          (batch.materialDescription?.toLowerCase().includes(term) ?? false) ||
          (batch.materialCode?.toLowerCase().includes(term) ?? false) ||
          (batch.bulkCode?.toLowerCase().includes(term) ?? false);
        if (!matchesSearch) return false;
      }

      // Status filter
      if (filters.status !== "all" && batch.status !== filters.status) {
        return false;
      }

      // Resource group filter
      if (filters.resourceGroup !== "all" && batch.planResourceId) {
        const resource = resources.find((r) => r.id === batch.planResourceId);
        if (resource?.groupName !== filters.resourceGroup) {
          return false;
        }
      }

      return true;
    });
  }, [batches, filters, resources]);

  const handleBatchClick = useCallback((batch: Batch) => {
    setSelectedBatchId(batch.id);
    setSheetOpen(true);
  }, []);

  useEffect(() => {
    if (!deepLinkBatchId) return;
    setSelectedBatchId(deepLinkBatchId);
    setSheetOpen(true);
  }, [deepLinkBatchId]);

  const handleSheetOpenChange = useCallback(
    (open: boolean) => {
      setSheetOpen(open);
      if (open || !deepLinkBatchId) return;

      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("batchId");
      setSearchParams(nextParams, { replace: true });
    },
    [deepLinkBatchId, searchParams, setSearchParams],
  );

  const isLoading = batchesLoading || resourcesLoading;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Master Schedule"
        description="View and manage batch schedules for the current week"
        actions={
          <div className="flex items-center gap-3">
            {hasPermission("planning.export") && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => exportBatchesCsv(filteredBatches, resources)}
                  disabled={filteredBatches.length === 0}
                >
                  <Download className="mr-1 h-4 w-4" />
                  Export CSV
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => exportBatchDateExport(filteredBatches)}
                  disabled={filteredBatches.length === 0}
                >
                  <Download className="mr-1 h-4 w-4" />
                  Date Export
                </Button>
              </>
            )}
            <WeekSelector week={week} />
          </div>
        }
      />

      <FilterBar
        filters={filters}
        onFiltersChange={setFilters}
        resources={resources}
      />

      <PermissionGate permission="alerts.read">
        <AlertManager mode="banner" activeOnly />
      </PermissionGate>

      <SummaryCards batches={filteredBatches} />

      <BatchTable
        batches={filteredBatches}
        resources={resources}
        isLoading={isLoading}
        onBatchClick={handleBatchClick}
      />

      <BatchDetailSheet
        batchId={selectedBatchId}
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
        resources={resources}
      />
    </div>
  );
}
