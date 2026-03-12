import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save, Trash2 } from "lucide-react";
import {
  substitutionRuleFormSchema,
  type SubstitutionRuleFormInput,
} from "@/lib/validators/rule";
import type { SubstitutionRule, SubstitutionConditions } from "@/types/rule";
import type { Resource } from "@/types/resource";

interface SubstitutionRuleFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: SubstitutionRule | null;
  resources: Resource[];
  isPending: boolean;
  isDeleting?: boolean;
  onSubmit: (data: SubstitutionRuleFormInput & { id?: string }) => void;
  onDelete?: (id: string) => void;
}

interface FormState {
  sourceResourceId: string | null;
  targetResourceId: string | null;
  maxVolume: string;
  minVolume: string;
  colorGroups: string;
  enabled: boolean;
}

const EMPTY_FORM: FormState = {
  sourceResourceId: null,
  targetResourceId: null,
  maxVolume: "",
  minVolume: "",
  colorGroups: "",
  enabled: true,
};

const NONE_VALUE = "__none__";

export function SubstitutionRuleForm({
  open,
  onOpenChange,
  rule,
  resources,
  isPending,
  isDeleting,
  onSubmit,
  onDelete,
}: SubstitutionRuleFormProps) {
  const isEdit = !!rule;
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      if (rule) {
        setForm({
          sourceResourceId: rule.sourceResourceId,
          targetResourceId: rule.targetResourceId,
          maxVolume: rule.conditions?.maxVolume?.toString() ?? "",
          minVolume: rule.conditions?.minVolume?.toString() ?? "",
          colorGroups: rule.conditions?.colorGroups?.join(", ") ?? "",
          enabled: rule.enabled,
        });
      } else {
        setForm(EMPTY_FORM);
      }
      setErrors({});
    }
  }, [open, rule]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: "" }));
  }

  function buildConditions(): SubstitutionConditions | null {
    const cond: SubstitutionConditions = {};
    if (form.minVolume) cond.minVolume = Number(form.minVolume);
    if (form.maxVolume) cond.maxVolume = Number(form.maxVolume);
    if (form.colorGroups.trim()) {
      cond.colorGroups = form.colorGroups
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return Object.keys(cond).length > 0 ? cond : null;
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const payload: Record<string, unknown> = {
      sourceResourceId: form.sourceResourceId,
      targetResourceId: form.targetResourceId,
      conditions: buildConditions(),
      enabled: form.enabled,
    };

    const result = substitutionRuleFormSchema.safeParse(payload);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as string;
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    onSubmit(isEdit ? { ...result.data, id: rule.id } : result.data);
  }

  const activeResources = resources.filter((r) => r.active);
  const resourceMap = new Map(resources.map((r) => [r.id, r]));
  const targetResource = form.targetResourceId
    ? resourceMap.get(form.targetResourceId) ?? null
    : null;

  function handleTargetChange(value: string) {
    const targetId = value === NONE_VALUE ? null : value;
    setField("targetResourceId", targetId);

    // Auto-populate volume fields from target resource capacity
    if (targetId) {
      const target = resourceMap.get(targetId);
      if (target) {
        if (target.maxCapacity != null && !form.maxVolume) {
          setField("maxVolume", target.maxCapacity.toString());
        }
        if (target.minCapacity != null && !form.minVolume) {
          setField("minVolume", target.minCapacity.toString());
        }
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {isEdit ? "Edit Substitution Rule" : "Add Substitution Rule"}
            </DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update which resource can substitute for another."
                : "Define a new resource substitution mapping."}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {/* Source Resource */}
            <div className="space-y-1">
              <Label htmlFor="sourceResource">Source Resource</Label>
              <Select
                value={form.sourceResourceId ?? NONE_VALUE}
                onValueChange={(v) =>
                  setField("sourceResourceId", v === NONE_VALUE ? null : v)
                }
              >
                <SelectTrigger id="sourceResource">
                  <SelectValue placeholder="Any resource" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>Any</SelectItem>
                  {activeResources.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.displayName ?? r.resourceCode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.sourceResourceId && (
                <p className="text-xs text-destructive">{errors.sourceResourceId}</p>
              )}
            </div>

            {/* Target Resource */}
            <div className="space-y-1">
              <Label htmlFor="targetResource">Target Resource</Label>
              <Select
                value={form.targetResourceId ?? NONE_VALUE}
                onValueChange={handleTargetChange}
              >
                <SelectTrigger id="targetResource">
                  <SelectValue placeholder="Any resource" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>Any</SelectItem>
                  {activeResources.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.displayName ?? r.resourceCode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.targetResourceId && (
                <p className="text-xs text-destructive">{errors.targetResourceId}</p>
              )}
            </div>

            {/* Min Volume */}
            <div className="space-y-1">
              <Label htmlFor="minVolume">Min Volume (L)</Label>
              <Input
                id="minVolume"
                type="number"
                min={0}
                value={form.minVolume}
                onChange={(e) => setField("minVolume", e.target.value)}
                placeholder={targetResource?.minCapacity != null
                  ? `Target min: ${targetResource.minCapacity.toLocaleString()}L`
                  : "Optional"}
              />
            </div>

            {/* Max Volume */}
            <div className="space-y-1">
              <Label htmlFor="maxVolume">Max Volume (L)</Label>
              <Input
                id="maxVolume"
                type="number"
                min={0}
                value={form.maxVolume}
                onChange={(e) => setField("maxVolume", e.target.value)}
                placeholder={targetResource?.maxCapacity != null
                  ? `Target max: ${targetResource.maxCapacity.toLocaleString()}L`
                  : "Optional"}
              />
            </div>

            {/* Colour Groups */}
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="colorGroups">Colour Groups</Label>
              <Input
                id="colorGroups"
                value={form.colorGroups}
                onChange={(e) => setField("colorGroups", e.target.value)}
                placeholder="e.g. white, light, pastel (comma separated)"
              />
            </div>

            {errors.conditions && (
              <p className="text-xs text-destructive sm:col-span-2">{errors.conditions}</p>
            )}

            {/* Enabled */}
            <div className="flex items-center gap-2 sm:col-span-2">
              <Switch
                id="subEnabled"
                checked={form.enabled}
                onCheckedChange={(checked) => setField("enabled", checked)}
              />
              <Label htmlFor="subEnabled">Enabled</Label>
            </div>
          </div>

          <DialogFooter className="mt-6">
            {isEdit && onDelete && (
              <Button
                type="button"
                variant="destructive"
                disabled={isPending || isDeleting}
                onClick={() => onDelete(rule.id)}
                className="mr-auto"
              >
                {isDeleting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Delete
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending || isDeleting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || isDeleting}>
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {isEdit ? "Save Changes" : "Create Rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
