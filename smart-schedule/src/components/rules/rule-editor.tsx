import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Save } from "lucide-react";
import type { ScheduleRule } from "@/types/rule";
import { useUpdateScheduleRule } from "@/hooks/use-rules";
import { usePermissions } from "@/hooks/use-permissions";
import { scheduleRuleFormSchema } from "@/lib/validators/rule";

interface RuleEditorProps {
  rule: ScheduleRule | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RuleEditor({ rule, open, onOpenChange }: RuleEditorProps) {
  const canEdit = usePermissions().hasPermission("rules.write");
  const updateRule = useUpdateScheduleRule();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [ruleType, setRuleType] = useState<"schedule" | "bulk">("schedule");
  const [conditionsText, setConditionsText] = useState("{}");
  const [actionsText, setActionsText] = useState("{}");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!rule) return;
    setName(rule.name);
    setDescription(rule.description ?? "");
    setEnabled(rule.enabled);
    setRuleType(rule.ruleType === "bulk" ? "bulk" : "schedule");
    setConditionsText(JSON.stringify(rule.conditions ?? {}, null, 2));
    setActionsText(JSON.stringify(rule.actions ?? {}, null, 2));
    setErrors({});
    setFormError(null);
  }, [rule]);

  const onSave = async () => {
    if (!rule) return;
    setFormError(null);
    setErrors({});

    // Structured Zod validation (includes schema-version guard)
    const result = scheduleRuleFormSchema.safeParse({
      name,
      description: description.trim() || null,
      ruleType,
      conditionsText,
      actionsText,
      enabled,
      ruleVersion: rule.ruleVersion,
    });

    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as string;
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    try {
      await updateRule.mutateAsync({
        id: rule.id,
        name: name.trim(),
        description: description.trim() || null,
        ruleType,
        conditionsText,
        actionsText,
        enabled,
        ruleVersion: rule.ruleVersion,
      });
      onOpenChange(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to save rule.");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {rule ? (
          <>
            <SheetHeader>
              <SheetTitle>{rule.name}</SheetTitle>
              <SheetDescription>
                {rule.description ?? "No description"}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-4">
              <div className="flex gap-2">
                {rule.ruleType && (
                  <Badge variant="outline">{rule.ruleType}</Badge>
                )}
                <Badge variant="secondary">Version {rule.ruleVersion}</Badge>
                <Badge variant={rule.enabled ? "default" : "destructive"}>
                  {rule.enabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>

              <Separator />

              <div>
                <Label htmlFor="rule-name" className="mb-2 block text-sm font-semibold">
                  Rule Name *
                </Label>
                <Input
                  id="rule-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (errors.name) setErrors((prev) => ({ ...prev, name: "" }));
                  }}
                  readOnly={!canEdit}
                />
                {errors.name && (
                  <p className="mt-1 text-xs text-destructive">{errors.name}</p>
                )}
              </div>

              <div>
                <Label htmlFor="rule-description" className="mb-2 block text-sm font-semibold">
                  Description
                </Label>
                <Textarea
                  id="rule-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  readOnly={!canEdit}
                  rows={3}
                />
              </div>

              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="rule-enabled" className="text-sm font-semibold">
                  Enabled
                </Label>
                <Switch
                  id="rule-enabled"
                  checked={enabled}
                  onCheckedChange={setEnabled}
                  disabled={!canEdit}
                />
              </div>

              <div>
                <Label htmlFor="rule-type" className="mb-2 block text-sm font-semibold">
                  Rule Type *
                </Label>
                <Select
                  value={ruleType}
                  onValueChange={(v) => {
                    setRuleType(v as "schedule" | "bulk");
                    if (errors.ruleType) setErrors((prev) => ({ ...prev, ruleType: "" }));
                  }}
                  disabled={!canEdit}
                >
                  <SelectTrigger id="rule-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="schedule">Schedule</SelectItem>
                    <SelectItem value="bulk">Bulk</SelectItem>
                  </SelectContent>
                </Select>
                {errors.ruleType && (
                  <p className="mt-1 text-xs text-destructive">{errors.ruleType}</p>
                )}
              </div>

              <div>
                <Label htmlFor="rule-conditions" className="mb-2 block text-sm font-semibold">
                  Conditions (JSON)
                </Label>
                <Textarea
                  id="rule-conditions"
                  value={conditionsText}
                  onChange={(e) => {
                    setConditionsText(e.target.value);
                    if (errors.conditionsText) setErrors((prev) => ({ ...prev, conditionsText: "" }));
                  }}
                  readOnly={!canEdit}
                  rows={8}
                  className="font-mono text-xs"
                />
                {errors.conditionsText && (
                  <p className="mt-1 text-xs text-destructive">{errors.conditionsText}</p>
                )}
              </div>

              <div>
                <Label htmlFor="rule-actions" className="mb-2 block text-sm font-semibold">
                  Actions (JSON)
                </Label>
                <Textarea
                  id="rule-actions"
                  value={actionsText}
                  onChange={(e) => {
                    setActionsText(e.target.value);
                    if (errors.actionsText) setErrors((prev) => ({ ...prev, actionsText: "" }));
                  }}
                  readOnly={!canEdit}
                  rows={8}
                  className="font-mono text-xs"
                />
                {errors.actionsText && (
                  <p className="mt-1 text-xs text-destructive">{errors.actionsText}</p>
                )}
              </div>

              {errors.ruleVersion && (
                <p className="text-xs text-destructive">{errors.ruleVersion}</p>
              )}

              {!canEdit && (
                <p className="text-xs text-muted-foreground">
                  You have read-only access for rules at this site.
                </p>
              )}

              {formError && <p className="text-xs text-destructive">{formError}</p>}

              {updateRule.error && (
                <p className="text-xs text-destructive">{updateRule.error.message}</p>
              )}
            </div>

            {canEdit && (
              <SheetFooter className="mt-6">
                <Button
                  onClick={onSave}
                  disabled={!name.trim() || updateRule.isPending}
                >
                  {updateRule.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Save Rule
                </Button>
              </SheetFooter>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Select a rule to view details.
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
