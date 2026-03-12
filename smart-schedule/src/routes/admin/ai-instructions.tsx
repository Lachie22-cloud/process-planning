import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePermissions } from "@/hooks/use-permissions";
import {
  useAiPromptSections,
  useUpdatePromptSection,
  useResetPromptSections,
  type AiPromptSection,
} from "@/hooks/use-ai-prompts";
import { Save, RotateCcw, RefreshCw } from "lucide-react";
import { Navigate } from "react-router-dom";

const CONTEXT_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  both: { label: "Chat & Scan", variant: "default" },
  chat: { label: "Chat Only", variant: "secondary" },
  scan: { label: "Scan Only", variant: "outline" },
};

function SectionCard({
  section,
  onSave,
  isSaving,
}: {
  section: AiPromptSection;
  onSave: (updates: { id: string; content?: string; enabled?: boolean }) => void;
  isSaving: boolean;
}) {
  const [content, setContent] = useState(section.content);
  const [enabled, setEnabled] = useState(section.enabled);
  const hasChanges = content !== section.content || enabled !== section.enabled;
  const ctxInfo = CONTEXT_LABELS[section.context] ?? { label: "Chat & Scan", variant: "default" as const };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-3">
          <CardTitle className="text-base">{section.label}</CardTitle>
          <Badge variant={ctxInfo.variant}>{ctxInfo.label}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {enabled ? "Enabled" : "Disabled"}
          </span>
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => setEnabled(checked)}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={Math.max(4, content.split("\n").length + 1)}
          className="font-mono text-sm"
          placeholder="Enter instructions for this section..."
        />
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Variables: {"{{siteName}}"}, {"{{siteId}}"}, {"{{userName}}"},{" "}
            {"{{currentDate}}"}, {"{{toolList}}"}
          </p>
          {hasChanges && (
            <Button
              size="sm"
              onClick={() => onSave({ id: section.id, content, enabled })}
              disabled={isSaving}
            >
              {isSaving ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminAiInstructionsPage() {
  const { hasPermission } = usePermissions();
  const { data: sections, isLoading } = useAiPromptSections();
  const updateSection = useUpdatePromptSection();
  const resetSections = useResetPromptSections();
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  if (!hasPermission("admin.settings")) {
    return <Navigate to="/admin" replace />;
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="AI Instructions"
        description="Configure the system prompt sections sent to the AI agent for this site"
      />

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {(sections ?? []).map((section) => (
              <SectionCard
                key={section.id}
                section={section}
                onSave={(updates) => updateSection.mutate(updates)}
                isSaving={updateSection.isPending}
              />
            ))}

            {sections?.length === 0 && (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  No prompt sections found. Click &quot;Reset All to Defaults&quot; to
                  create the default sections.
                </CardContent>
              </Card>
            )}
          </div>

          <div className="flex justify-end pt-4">
            <Button
              variant="outline"
              onClick={() => setResetDialogOpen(true)}
              disabled={resetSections.isPending}
            >
              {resetSections.isPending ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="mr-2 h-4 w-4" />
              )}
              Reset All to Defaults
            </Button>
          </div>
        </>
      )}

      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset All Prompt Sections</DialogTitle>
            <DialogDescription>
              This will delete all current prompt sections and restore the
              default instructions. Any customisations will be lost. Are you sure?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResetDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                resetSections.mutate(undefined, {
                  onSuccess: () => setResetDialogOpen(false),
                });
              }}
              disabled={resetSections.isPending}
            >
              {resetSections.isPending ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Reset to Defaults
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
