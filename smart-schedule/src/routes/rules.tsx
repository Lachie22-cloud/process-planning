import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { RuleList } from "@/components/rules/rule-list";
import { RuleEditor } from "@/components/rules/rule-editor";
import { SubstitutionMatrix } from "@/components/rules/substitution-matrix";
import { SubstitutionRuleForm } from "@/components/rules/substitution-rule-form";
import { SubstitutionGenerationSettings } from "@/components/rules/substitution-generation-settings";
import { GenerateRulesDialog } from "@/components/rules/generate-rules-dialog";
import { DayBlocksPanel } from "@/components/rules/day-blocks-panel";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Sparkles } from "lucide-react";
import {
  useScheduleRules,
  useSubstitutionRules,
  useToggleScheduleRule,
  useCreateSubstitutionRule,
  useUpdateSubstitutionRule,
  useDeleteSubstitutionRule,
  useToggleSubstitutionRule,
  useSubstitutionGenerationSettings,
  useBulkCreateSubstitutionRules,
} from "@/hooks/use-rules";
import { useResources } from "@/hooks/use-resources";
import { usePermissions } from "@/hooks/use-permissions";
import { DEFAULT_GENERATION_CONFIG } from "@/lib/constants/substitution-generation-defaults";
import type { ScheduleRule, SubstitutionRule } from "@/types/rule";
import type { SubstitutionRuleFormInput } from "@/lib/validators/rule";

export function RulesPage() {
  const { data: scheduleRules = [], isLoading: rulesLoading } =
    useScheduleRules();
  const { data: substitutionRules = [], isLoading: subsLoading } =
    useSubstitutionRules();
  const { data: resources = [] } = useResources();
  const { data: generationSettings } = useSubstitutionGenerationSettings();
  const toggleScheduleRule = useToggleScheduleRule();
  const createSubRule = useCreateSubstitutionRule();
  const updateSubRule = useUpdateSubstitutionRule();
  const deleteSubRule = useDeleteSubstitutionRule();
  const toggleSubRule = useToggleSubstitutionRule();
  const bulkCreate = useBulkCreateSubstitutionRules();
  const { hasPermission, isAdmin } = usePermissions();
  const canEdit = hasPermission("rules.write");

  const [selectedScheduleRule, setSelectedScheduleRule] = useState<ScheduleRule | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const [selectedSubRule, setSelectedSubRule] = useState<SubstitutionRule | null>(null);
  const [subFormOpen, setSubFormOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);

  function handleSubFormSubmit(data: SubstitutionRuleFormInput & { id?: string }) {
    if (data.id) {
      updateSubRule.mutate(
        { ...data, id: data.id },
        { onSuccess: () => setSubFormOpen(false) },
      );
    } else {
      createSubRule.mutate(data, {
        onSuccess: () => setSubFormOpen(false),
      });
    }
  }

  function handleSubDelete(id: string) {
    deleteSubRule.mutate(id, {
      onSuccess: () => setSubFormOpen(false),
    });
  }

  const generationConfig = generationSettings?.config ?? DEFAULT_GENERATION_CONFIG;
  const generationEnabled = generationSettings?.enabled ?? false;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Rules Engine"
        description="Configure substitution and scheduling rules"
      />

      <Tabs defaultValue="schedule">
        <TabsList>
          <TabsTrigger value="schedule">
            Schedule Rules ({scheduleRules.length})
          </TabsTrigger>
          <TabsTrigger value="substitution">
            Substitutions ({substitutionRules.length})
          </TabsTrigger>
          <TabsTrigger value="day-blocks">
            Day Blocks
          </TabsTrigger>
        </TabsList>

        <TabsContent value="schedule" className="mt-4">
          <RuleList
            rules={scheduleRules}
            isLoading={rulesLoading}
            canToggle={canEdit}
            onToggle={(ruleId, enabled) => {
              if (!canEdit) return;
              toggleScheduleRule.mutate({ id: ruleId, enabled });
            }}
            onSelect={(rule) => {
              setSelectedScheduleRule(rule);
              setEditorOpen(true);
            }}
          />
        </TabsContent>

        <TabsContent value="substitution" className="mt-4 space-y-4">
          {canEdit && (
            <div className="flex items-center justify-end gap-2">
              {generationEnabled && (
                <Button
                  variant="outline"
                  onClick={() => setGenerateOpen(true)}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate Rules
                </Button>
              )}
              <Button
                onClick={() => {
                  setSelectedSubRule(null);
                  setSubFormOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Substitution Rule
              </Button>
            </div>
          )}
          <SubstitutionMatrix
            rules={substitutionRules}
            resources={resources}
            isLoading={subsLoading}
            canEdit={canEdit}
            onToggle={(ruleId, enabled) =>
              toggleSubRule.mutate({ id: ruleId, enabled })
            }
            onSelect={(rule) => {
              setSelectedSubRule(rule);
              setSubFormOpen(true);
            }}
          />
          {isAdmin && <SubstitutionGenerationSettings />}
        </TabsContent>

        <TabsContent value="day-blocks" className="mt-4">
          <DayBlocksPanel canEdit={canEdit} />
        </TabsContent>
      </Tabs>

      <RuleEditor
        rule={selectedScheduleRule}
        open={editorOpen}
        onOpenChange={setEditorOpen}
      />

      <SubstitutionRuleForm
        open={subFormOpen}
        onOpenChange={setSubFormOpen}
        rule={selectedSubRule}
        resources={resources}
        isPending={createSubRule.isPending || updateSubRule.isPending}
        isDeleting={deleteSubRule.isPending}
        onSubmit={handleSubFormSubmit}
        onDelete={handleSubDelete}
      />

      <GenerateRulesDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        resources={resources}
        existingRules={substitutionRules}
        config={generationConfig}
        isPending={bulkCreate.isPending}
        onGenerate={(candidates) => {
          bulkCreate.mutate(candidates, {
            onSuccess: () => setGenerateOpen(false),
          });
        }}
      />
    </div>
  );
}
