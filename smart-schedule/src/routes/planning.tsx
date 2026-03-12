import { useState, useCallback } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { FileUpload } from "@/components/planning/file-upload";
import { ImportPreview } from "@/components/planning/import-preview";
import { CoverageTable } from "@/components/planning/coverage-table";
import { StockHeatmap } from "@/components/planning/stock-heatmap";
import { VettingPanel } from "@/components/planning/vetting-panel";
import { DraftReviewPanel } from "@/components/ai/draft-review";
import { ScheduleHealthBar } from "@/components/shared/schedule-health-bar";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useImport } from "@/hooks/use-import";
import { useBatches } from "@/hooks/use-batches";
import { useResources } from "@/hooks/use-resources";
import { useWeek } from "@/hooks/use-week";
import { useCurrentSite } from "@/hooks/use-current-site";
import { usePurgeSiteData } from "@/hooks/use-batch-mutations";
import { useHealthReport } from "@/hooks/use-health-report";
import { useAiScans, useTriggerScan } from "@/hooks/use-ai-scans";

export function PlanningPage() {
  const {
    files,
    batches: importBatchList,
    isProcessing,
    addFiles,
    clearFiles,
    importBatches,
    isImporting,
    importError,
    importSuccess,
  } = useImport();

  const { data: dbBatches = [] } = useBatches();
  const { data: resources = [] } = useResources();
  const { weekEnding } = useWeek();
  const { user } = useCurrentSite();
  const purgeMutation = usePurgeSiteData();
  const { report: healthReport, isLoading: healthLoading } = useHealthReport();
  const { data: aiScans = [] } = useAiScans(1);
  const latestCompletedScan = aiScans.find((s) => s.status === "completed");

  const triggerScan = useTriggerScan();
  const handleRunAnalysis = useCallback(() => {
    triggerScan.mutate("schedule_optimization");
  }, [triggerScan]);
  const [purgeOpen, setPurgeOpen] = useState(false);

  const isAdmin = user?.role === "site_admin" || user?.role === "super_admin";

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Planning"
        description="Import SAP data, analyse material coverage, and vet batches"
        actions={
          isAdmin ? (
            <AlertDialog open={purgeOpen} onOpenChange={setPurgeOpen}>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  Purge All Data
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Purge all site data?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all {dbBatches.length} batch
                    {dbBatches.length !== 1 ? "es" : ""} and linked fill orders
                    for this site. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    disabled={purgeMutation.isPending}
                    onClick={() => {
                      purgeMutation.mutate(undefined, {
                        onSettled: () => setPurgeOpen(false),
                      });
                    }}
                  >
                    {purgeMutation.isPending ? "Purging…" : "Purge Everything"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : undefined
        }
      />

      <ScheduleHealthBar
        report={healthReport}
        isLoading={healthLoading}
        onRunAnalysis={handleRunAnalysis}
        isAnalysing={triggerScan.isPending}
        aiScanReport={latestCompletedScan?.report}
      />

      <FileUpload
        files={files}
        isProcessing={isProcessing}
        onAddFiles={addFiles}
        onClear={clearFiles}
      />

      <ImportPreview
        batches={importBatchList}
        isImporting={isImporting}
        importError={importError}
        importSuccess={importSuccess}
        onImport={importBatches}
      />

      <CoverageTable files={files} batches={dbBatches} />

      <VettingPanel batches={dbBatches} />

      <StockHeatmap
        batches={dbBatches}
        resources={resources}
        weekEnding={weekEnding}
      />

      <DraftReviewPanel />
    </div>
  );
}
