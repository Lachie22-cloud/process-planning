import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Loader2, Save, RotateCcw } from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import {
  useSubstitutionGenerationSettings,
  useUpdateSubstitutionGenerationSettings,
} from "@/hooks/use-rules";
import { DEFAULT_GENERATION_CONFIG } from "@/lib/constants/substitution-generation-defaults";
import type { SubstitutionGenerationConfig } from "@/lib/validators/substitution-generation-settings";
import {
  CAPACITY_TEMPLATES,
  GROUP_BY_KEYS,
  DUPLICATE_POLICIES,
  type CapacityTemplate,
  type GroupByKey,
  type DuplicatePolicy,
} from "@/lib/validators/substitution-generation-settings";

/* ------------------------------------------------------------------ */
/*  Display labels                                                     */
/* ------------------------------------------------------------------ */

const CAPACITY_TEMPLATE_LABELS: Record<string, string> = {
  maxVolume: "Max Volume",
  minVolume: "Min Volume",
  both: "Both",
};

const GROUP_BY_LABELS: Record<GroupByKey, string> = {
  group: "Group",
  trunk_line: "Trunk Line",
  both: "Both",
};

const DUPLICATE_POLICY_LABELS: Record<DuplicatePolicy, string> = {
  skip: "Skip duplicates",
  upsert: "Update existing",
  create_disabled: "Create as disabled",
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function SubstitutionGenerationSettings() {
  const { isAdmin } = usePermissions();
  const canEdit = isAdmin;

  const { data: settings, isLoading } = useSubstitutionGenerationSettings();
  const updateSettings = useUpdateSubstitutionGenerationSettings();

  const [enabled, setEnabled] = useState(false);
  const [config, setConfig] = useState<SubstitutionGenerationConfig>(DEFAULT_GENERATION_CONFIG);

  // Sync form state from server data
  useEffect(() => {
    if (settings) {
      setEnabled(settings.enabled);
      setConfig(settings.config);
    }
  }, [settings]);

  const savedEnabled = settings?.enabled ?? false;
  const savedConfig = settings?.config ?? DEFAULT_GENERATION_CONFIG;

  const hasChanges = useMemo(
    () =>
      enabled !== savedEnabled ||
      JSON.stringify(config) !== JSON.stringify(savedConfig),
    [enabled, config, savedEnabled, savedConfig],
  );

  function resetForm() {
    setEnabled(savedEnabled);
    setConfig(savedConfig);
  }

  function handleSave() {
    updateSettings.mutate({ enabled, config });
  }

  // Helpers to update nested config sections
  function setScope<K extends keyof SubstitutionGenerationConfig["scope"]>(
    key: K,
    value: SubstitutionGenerationConfig["scope"][K],
  ) {
    setConfig((prev) => ({ ...prev, scope: { ...prev.scope, [key]: value } }));
  }

  function setCapacity<K extends keyof SubstitutionGenerationConfig["capacityStrategy"]>(
    key: K,
    value: SubstitutionGenerationConfig["capacityStrategy"][K],
  ) {
    setConfig((prev) => ({
      ...prev,
      capacityStrategy: { ...prev.capacityStrategy, [key]: value },
    }));
  }

  function setEligibility<K extends keyof SubstitutionGenerationConfig["resourceEligibility"]>(
    key: K,
    value: SubstitutionGenerationConfig["resourceEligibility"][K],
  ) {
    setConfig((prev) => ({
      ...prev,
      resourceEligibility: { ...prev.resourceEligibility, [key]: value },
    }));
  }

  function setSafety<K extends keyof SubstitutionGenerationConfig["safety"]>(
    key: K,
    value: SubstitutionGenerationConfig["safety"][K],
  ) {
    setConfig((prev) => ({ ...prev, safety: { ...prev.safety, [key]: value } }));
  }

  function setConditionTemplates<K extends keyof SubstitutionGenerationConfig["conditionTemplates"]>(
    key: K,
    value: SubstitutionGenerationConfig["conditionTemplates"][K],
  ) {
    setConfig((prev) => ({
      ...prev,
      conditionTemplates: { ...prev.conditionTemplates, [key]: value },
    }));
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Rule Generation Settings</CardTitle>
          <div className="flex items-center gap-2">
            <Label htmlFor="gen-enabled" className="text-sm font-normal text-muted-foreground">
              {enabled ? "Enabled" : "Disabled"}
            </Label>
            <Switch
              id="gen-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={!canEdit}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* ---------- Scope ---------- */}
        <section className="space-y-3">
          <h3 className="text-sm font-medium">Scope</h3>
          <p className="text-xs text-muted-foreground">
            Control which resource pairs are considered for rule generation.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <SwitchField
              id="scope-same-group"
              label="Same group"
              description="Generate rules within the same group"
              checked={config.scope.sameGroup}
              onCheckedChange={(v) => setScope("sameGroup", v)}
              disabled={!canEdit}
            />
            <SwitchField
              id="scope-cross-group"
              label="Cross group"
              description="Allow substitutions across different groups"
              checked={config.scope.crossGroup}
              onCheckedChange={(v) => setScope("crossGroup", v)}
              disabled={!canEdit}
            />
            <SwitchField
              id="scope-cross-trunk-line"
              label="Cross trunk line"
              description="Allow substitutions across trunk line pairs"
              checked={config.scope.crossTrunkLine}
              onCheckedChange={(v) => setScope("crossTrunkLine", v)}
              disabled={!canEdit}
            />
            <SwitchField
              id="scope-cross-chemical-base"
              label="Cross chemical base"
              description="Allow different chemical bases"
              checked={config.scope.crossChemicalBase}
              onCheckedChange={(v) => setScope("crossChemicalBase", v)}
              disabled={!canEdit}
            />
          </div>
        </section>

        <Separator />

        {/* ---------- Capacity Strategy ---------- */}
        <section className="space-y-3">
          <h3 className="text-sm font-medium">Capacity Strategy</h3>
          <p className="text-xs text-muted-foreground">
            Define which volume conditions are generated based on capacity relationships.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <CapacityTemplateSelect
              id="cap-same"
              label="Same capacity"
              value={config.capacityStrategy.sameCapacityTemplate}
              onValueChange={(v) => setCapacity("sameCapacityTemplate", v)}
              disabled={!canEdit}
            />
            <CapacityTemplateSelect
              id="cap-large-to-small"
              label="Large to small"
              value={config.capacityStrategy.largeToSmallTemplate}
              onValueChange={(v) => setCapacity("largeToSmallTemplate", v)}
              disabled={!canEdit}
            />
            <CapacityTemplateSelect
              id="cap-small-to-large"
              label="Small to large"
              value={config.capacityStrategy.smallToLargeTemplate}
              onValueChange={(v) => setCapacity("smallToLargeTemplate", v)}
              disabled={!canEdit}
            />
            <SwitchField
              id="cap-both-min-max"
              label="Apply both min & max"
              description="Use both min and max from target capacity range"
              checked={config.capacityStrategy.applyBothMinMax}
              onCheckedChange={(v) => setCapacity("applyBothMinMax", v)}
              disabled={!canEdit}
            />
          </div>
        </section>

        <Separator />

        {/* ---------- Resource Eligibility ---------- */}
        <section className="space-y-3">
          <h3 className="text-sm font-medium">Resource Eligibility</h3>
          <p className="text-xs text-muted-foreground">
            Filter which resources are included as candidates.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <SwitchField
              id="elig-include-inactive"
              label="Include inactive"
              description="Include inactive resources in generation"
              checked={config.resourceEligibility.includeInactive}
              onCheckedChange={(v) => setEligibility("includeInactive", v)}
              disabled={!canEdit}
            />
            <SwitchField
              id="elig-exclude-missing"
              label="Exclude missing fields"
              description="Skip resources missing group or capacity data"
              checked={config.resourceEligibility.excludeMissingFields}
              onCheckedChange={(v) => setEligibility("excludeMissingFields", v)}
              disabled={!canEdit}
            />
            <div className="space-y-2">
              <Label htmlFor="elig-group-by">Group by</Label>
              <Select
                value={config.resourceEligibility.groupByKey}
                onValueChange={(v) => setEligibility("groupByKey", v as GroupByKey)}
                disabled={!canEdit}
              >
                <SelectTrigger id="elig-group-by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_BY_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>
                      {GROUP_BY_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                How resources are grouped for pair generation
              </p>
            </div>
          </div>
        </section>

        <Separator />

        {/* ---------- Safety / Duplicate Handling ---------- */}
        <section className="space-y-3">
          <h3 className="text-sm font-medium">Duplicate Handling</h3>
          <p className="text-xs text-muted-foreground">
            Control how existing rules affect generation.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="safety-dup-policy">Duplicate policy</Label>
              <Select
                value={config.safety.duplicatePolicy}
                onValueChange={(v) => setSafety("duplicatePolicy", v as DuplicatePolicy)}
                disabled={!canEdit}
              >
                <SelectTrigger id="safety-dup-policy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DUPLICATE_POLICIES.map((policy) => (
                    <SelectItem key={policy} value={policy}>
                      {DUPLICATE_POLICY_LABELS[policy]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <SwitchField
              id="safety-disabled-dups"
              label="Disabled count as duplicates"
              description="Treat disabled existing rules as duplicates"
              checked={config.safety.disabledCountAsDuplicates}
              onCheckedChange={(v) => setSafety("disabledCountAsDuplicates", v)}
              disabled={!canEdit}
            />
            <SwitchField
              id="safety-preview-default"
              label="Preview mode default"
              description="Show preview dialog before bulk creation"
              checked={config.safety.previewModeDefault}
              onCheckedChange={(v) => setSafety("previewModeDefault", v)}
              disabled={!canEdit}
            />
          </div>
        </section>

        <Separator />

        {/* ---------- Condition Templates ---------- */}
        <section className="space-y-3">
          <h3 className="text-sm font-medium">Condition Templates</h3>
          <p className="text-xs text-muted-foreground">
            Select which condition types are generated on new rules.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <SwitchField
              id="cond-min-volume"
              label="Min volume"
              description="Generate minVolume conditions from target capacity"
              checked={config.conditionTemplates.minVolume}
              onCheckedChange={(v) => setConditionTemplates("minVolume", v)}
              disabled={!canEdit}
            />
            <SwitchField
              id="cond-max-volume"
              label="Max volume"
              description="Generate maxVolume conditions from target capacity"
              checked={config.conditionTemplates.maxVolume}
              onCheckedChange={(v) => setConditionTemplates("maxVolume", v)}
              disabled={!canEdit}
            />
            <SwitchField
              id="cond-colour-groups"
              label="Colour groups"
              description="Generate colourGroups conditions from resource data"
              checked={config.conditionTemplates.colourGroups}
              onCheckedChange={(v) => setConditionTemplates("colourGroups", v)}
              disabled={!canEdit}
            />
          </div>
        </section>

        {/* ---------- Error / Actions ---------- */}
        {updateSettings.error && (
          <p className="text-xs text-destructive">{updateSettings.error.message}</p>
        )}

        {canEdit ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={resetForm}
              disabled={updateSettings.isPending || !hasChanges}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset
            </Button>
            <Button
              onClick={handleSave}
              disabled={updateSettings.isPending || !hasChanges}
            >
              {updateSettings.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Settings
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Generation settings are read-only. Contact a site admin to make changes.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

interface SwitchFieldProps {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

function SwitchField({ id, label, description, checked, onCheckedChange, disabled }: SwitchFieldProps) {
  return (
    <div className="flex items-start gap-3">
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="mt-0.5"
      />
      <div>
        <Label htmlFor={id} className="text-sm leading-none">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </div>
    </div>
  );
}

interface CapacityTemplateSelectProps {
  id: string;
  label: string;
  value: CapacityTemplate | null;
  onValueChange: (value: CapacityTemplate | null) => void;
  disabled?: boolean;
}

function CapacityTemplateSelect({
  id,
  label,
  value,
  onValueChange,
  disabled,
}: CapacityTemplateSelectProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value ?? "__none__"}
        onValueChange={(v) => onValueChange(v === "__none__" ? null : (v as CapacityTemplate))}
        disabled={disabled}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">None</SelectItem>
          {CAPACITY_TEMPLATES.map((t) => (
            <SelectItem key={t} value={t}>
              {CAPACITY_TEMPLATE_LABELS[t]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
