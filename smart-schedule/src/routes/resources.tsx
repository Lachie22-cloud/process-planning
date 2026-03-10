import { useState, useMemo, useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { WeekSelector } from "@/components/schedule/week-selector";
import { ResourceTimeline } from "@/components/resources/resource-timeline";
import { BatchDetailSheet } from "@/components/schedule/batch-detail-sheet";
import { RescheduleDialog } from "@/components/resources/reschedule-dialog";
import { AlertManager } from "@/components/alerts/alert-manager";
import { DraftReviewPanel } from "@/components/ai/draft-review";
import { PermissionGate } from "@/components/shared/permission-gate";
import { ScheduleHealthBar } from "@/components/shared/schedule-health-bar";
import { Wand2, Download } from "lucide-react";
import { useWeek } from "@/hooks/use-week";
import { useBatches } from "@/hooks/use-batches";
import { useResources } from "@/hooks/use-resources";
import { useResourceBlocks } from "@/hooks/use-resource-blocks";
import { useDayBlocks } from "@/hooks/use-day-blocks";
import { useBulkAssignResources } from "@/hooks/use-batch-mutations";
import { useHealthReport } from "@/hooks/use-health-report";
import { useAiScans, useTriggerScan } from "@/hooks/use-ai-scans";
import { useColourGroups, useColourTransitions } from "@/hooks/use-colour-groups";
import { useSubstitutionRules, useScheduleRules } from "@/hooks/use-rules";
import { usePermissions } from "@/hooks/use-permissions";
import { useSpotlight } from "@/contexts/spotlight-context";
import { assignBatchToResource } from "@/lib/utils/resource-assignment";
import { exportBatchesCsv } from "@/lib/utils/csv-export";
import type { Batch } from "@/types/batch";
import type { ImportBatch } from "@/hooks/use-import";

export function ResourcesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const week = useWeek();
  const { data: resources = [], isLoading: resourcesLoading } = useResources();
  const deepLinkBatchId = searchParams.get("batchId");

  const weekStartStr = useMemo(
    () => format(week.weekStart, "yyyy-MM-dd"),
    [week.weekStart],
  );

  const { data: batches = [], isLoading: batchesLoading } = useBatches({
    weekStart: weekStartStr,
    weekEnding: week.weekEndingStr,
  });

  const { data: blocks = [], isLoading: blocksLoading } = useResourceBlocks({
    weekStart: weekStartStr,
    weekEnding: week.weekEndingStr,
  });

  const { data: dayBlocks = [] } = useDayBlocks({
    weekStart: weekStartStr,
    weekEnding: week.weekEndingStr,
  });

  const bulkAssign = useBulkAssignResources();

  const { report: healthReport, isLoading: healthLoading } = useHealthReport({
    weekStart: weekStartStr,
    weekEnding: week.weekEndingStr,
  });

  const { data: aiScans = [] } = useAiScans(5);
  const latestCompletedScan = aiScans.find((s) => s.status === "completed");
  const isScanning = aiScans.some(
    (s) => s.status === "pending" || s.status === "running",
  );

  const triggerScan = useTriggerScan();
  const handleRunAnalysis = useCallback(() => {
    triggerScan.mutate("schedule_optimization");
  }, [triggerScan]);

  // Scoring context data for RescheduleDialog
  const { data: colourGroups = [] } = useColourGroups();
  const { data: colourTransitions = [] } = useColourTransitions();
  const { data: substitutionRules = [] } = useSubstitutionRules();
  const { data: scheduleRules = [] } = useScheduleRules();

  const { hasPermission } = usePermissions();
  const { spotlight, spotlightBatch } = useSpotlight();

  // Navigate to the correct week when spotlight includes a target date
  useEffect(() => {
    if (spotlight.active && spotlight.targetDate) {
      const targetDate = new Date(spotlight.targetDate + "T00:00:00");
      if (!isNaN(targetDate.getTime())) {
        week.goToDate(targetDate);
      }
    }
  }, [spotlight.active, spotlight.targetDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reschedulingBatch, setReschedulingBatch] = useState<Batch | null>(null);

  const unassignedBatches = useMemo(
    () => batches.filter((b) => !b.planResourceId),
    [batches],
  );

  const handleAutoAssign = useCallback(() => {
    if (unassignedBatches.length === 0) {
      toast.info("All batches are already assigned to resources");
      return;
    }

    const assignments = new Map<string, string>();
    for (const batch of unassignedBatches) {
      // Convert Batch to ImportBatch-like shape for the assignment function
      const importBatch: ImportBatch = {
        sapOrder: batch.sapOrder,
        materialCode: batch.materialCode,
        materialDescription: batch.materialDescription,
        bulkCode: batch.bulkCode,
        planDate: batch.planDate,
        batchVolume: batch.batchVolume,
        sapColorGroup: batch.sapColorGroup,
        packSize: batch.packSize,
        rmAvailable: batch.rmAvailable,
        packagingAvailable: batch.packagingAvailable,
        stockCover: batch.stockCover,
        safetyStock: batch.safetyStock,
        poDate: batch.poDate,
        poQuantity: batch.poQuantity,
        forecast: batch.forecast,
        materialShortage: batch.materialShortage,
        sapMixerResource: null,
        sapDisperser1: null,
        sapDisperser2: null,
        sapPreMixCount: null,
        sapIpt: null,
        sapFillOrder: null,
        sapFillQuantity: null,
      };
      const resourceId = assignBatchToResource(importBatch, resources);
      if (resourceId) {
        assignments.set(batch.id, resourceId);
      }
    }

    if (assignments.size === 0) {
      toast.warning("Could not find suitable resources for any unassigned batches");
      return;
    }

    bulkAssign.mutate(assignments, {
      onSuccess: (count) => {
        toast.success(`Assigned ${count} batch${count !== 1 ? "es" : ""} to resources`);
      },
      onError: (err) => {
        toast.error(err instanceof Error ? err.message : "Failed to assign resources");
      },
    });
  }, [unassignedBatches, resources, bulkAssign]);

  const handleBatchClick = useCallback((batch: Batch) => {
    setSelectedBatchId(batch.id);
    setSheetOpen(true);
  }, []);

  const handleRescheduleFromSheet = useCallback(
    (batchId: string) => {
      const batch = batches.find((b) => b.id === batchId);
      if (batch) {
        setReschedulingBatch(batch);
      }
    },
    [batches],
  );

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

  const isLoading = batchesLoading || resourcesLoading || blocksLoading;

  return (
    <div className="space-y-6 overflow-x-auto p-6">
      <PageHeader
        title="Resource View"
        description="Visualise batch assignments across resources for the week"
        actions={
          <div className="flex items-center gap-3">
            {hasPermission("planning.export") && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => exportBatchesCsv(batches, resources)}
                disabled={batches.length === 0}
              >
                <Download className="mr-1 h-4 w-4" />
                Export CSV
              </Button>
            )}
            {unassignedBatches.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleAutoAssign}
                disabled={bulkAssign.isPending}
              >
                <Wand2 className="mr-1 h-4 w-4" />
                Auto-assign ({unassignedBatches.length})
              </Button>
            )}
            <WeekSelector week={week} />
          </div>
        }
      />

      <ScheduleHealthBar
        report={healthReport}
        isLoading={healthLoading}
        onRunAnalysis={handleRunAnalysis}
        isAnalysing={isScanning || triggerScan.isPending}
        aiScanReport={latestCompletedScan?.report}
        onSpotlightBatch={spotlightBatch}
      />

      <DraftReviewPanel compactMode />

      <PermissionGate permission="alerts.read">
        <AlertManager mode="banner" activeOnly />
      </PermissionGate>

      <ResourceTimeline
        batches={batches}
        resources={resources}
        blocks={blocks}
        dayBlocks={dayBlocks}
        weekStart={week.weekStart}
        weekEnding={week.weekEnding}
        isLoading={isLoading}
        onBatchClick={handleBatchClick}
      />

      <BatchDetailSheet
        batchId={selectedBatchId}
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
        resources={resources}
        onReschedule={handleRescheduleFromSheet}
      />

      {/* Reschedule dialog triggered from BatchDetailSheet */}
      {reschedulingBatch && (
        <RescheduleDialog
          open={!!reschedulingBatch}
          onOpenChange={(open) => {
            if (!open) setReschedulingBatch(null);
          }}
          batch={reschedulingBatch}
          resources={resources}
          batches={batches}
          blocks={blocks}
          colourGroups={colourGroups}
          colourTransitions={colourTransitions}
          substitutionRules={substitutionRules}
          scheduleRules={scheduleRules}
        />
      )}
    </div>
  );
}
