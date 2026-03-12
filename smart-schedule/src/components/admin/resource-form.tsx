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
import { Loader2, Save } from "lucide-react";
import { resourceFormSchema, type ResourceFormInput } from "@/lib/validators/resource";
import type { Resource } from "@/types/resource";

interface ResourceFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource: Resource | null;
  isPending: boolean;
  onSubmit: (data: ResourceFormInput & { id?: string }) => void;
}

const EMPTY_FORM: ResourceFormInput = {
  resourceCode: "",
  resourceType: "mixer",
  displayName: null,
  trunkLine: null,
  groupName: null,
  minCapacity: null,
  maxCapacity: null,
  maxBatchesPerDay: 1,
  chemicalBase: null,
  sortOrder: 0,
  active: true,
};

export function ResourceForm({
  open,
  onOpenChange,
  resource,
  isPending,
  onSubmit,
}: ResourceFormProps) {
  const isEdit = !!resource;
  const [form, setForm] = useState<ResourceFormInput>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      if (resource) {
        setForm({
          resourceCode: resource.resourceCode,
          resourceType: resource.resourceType,
          displayName: resource.displayName,
          trunkLine: resource.trunkLine,
          groupName: resource.groupName,
          minCapacity: resource.minCapacity,
          maxCapacity: resource.maxCapacity,
          maxBatchesPerDay: resource.maxBatchesPerDay,
          chemicalBase: resource.chemicalBase,
          sortOrder: resource.sortOrder,
          active: resource.active,
        });
      } else {
        setForm(EMPTY_FORM);
      }
      setErrors({});
    }
  }, [open, resource]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = resourceFormSchema.safeParse(form);
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
    onSubmit(isEdit ? { ...result.data, id: resource.id } : result.data);
  }

  function setField<K extends keyof ResourceFormInput>(key: K, value: ResourceFormInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: "" }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit Resource" : "Add Resource"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update the resource configuration."
                : "Add a new mixer, disperser, or pot to this site."}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {/* Resource Code */}
            <div className="space-y-1">
              <Label htmlFor="resourceCode">Resource Code *</Label>
              <Input
                id="resourceCode"
                value={form.resourceCode}
                onChange={(e) => setField("resourceCode", e.target.value)}
                placeholder="e.g. MIX-01"
              />
              {errors.resourceCode && (
                <p className="text-xs text-destructive">{errors.resourceCode}</p>
              )}
            </div>

            {/* Type */}
            <div className="space-y-1">
              <Label htmlFor="resourceType">Type *</Label>
              <Select
                value={form.resourceType}
                onValueChange={(v) =>
                  setField("resourceType", v as ResourceFormInput["resourceType"])
                }
              >
                <SelectTrigger id="resourceType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mixer">Mixer</SelectItem>
                  <SelectItem value="disperser">Disperser</SelectItem>
                  <SelectItem value="pot">Pot</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Display Name */}
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                value={form.displayName ?? ""}
                onChange={(e) => setField("displayName", e.target.value || null)}
                placeholder="Human-readable name"
              />
            </div>

            {/* Trunk Line */}
            <div className="space-y-1">
              <Label htmlFor="trunkLine">Trunk Line</Label>
              <Input
                id="trunkLine"
                value={form.trunkLine ?? ""}
                onChange={(e) => setField("trunkLine", e.target.value || null)}
              />
            </div>

            {/* Group Name */}
            <div className="space-y-1">
              <Label htmlFor="groupName">Group</Label>
              <Input
                id="groupName"
                value={form.groupName ?? ""}
                onChange={(e) => setField("groupName", e.target.value || null)}
              />
            </div>

            {/* Min Capacity */}
            <div className="space-y-1">
              <Label htmlFor="minCapacity">Min Capacity (L)</Label>
              <Input
                id="minCapacity"
                type="number"
                min={0}
                value={form.minCapacity ?? ""}
                onChange={(e) =>
                  setField("minCapacity", e.target.value ? Number(e.target.value) : null)
                }
              />
              {errors.minCapacity && (
                <p className="text-xs text-destructive">{errors.minCapacity}</p>
              )}
            </div>

            {/* Max Capacity */}
            <div className="space-y-1">
              <Label htmlFor="maxCapacity">Max Capacity (L)</Label>
              <Input
                id="maxCapacity"
                type="number"
                min={0}
                value={form.maxCapacity ?? ""}
                onChange={(e) =>
                  setField("maxCapacity", e.target.value ? Number(e.target.value) : null)
                }
              />
              {errors.maxCapacity && (
                <p className="text-xs text-destructive">{errors.maxCapacity}</p>
              )}
            </div>

            {/* Max Batches Per Day */}
            <div className="space-y-1">
              <Label htmlFor="maxBatchesPerDay">Max Batches/Day</Label>
              <Input
                id="maxBatchesPerDay"
                type="number"
                min={1}
                value={form.maxBatchesPerDay}
                onChange={(e) => setField("maxBatchesPerDay", Number(e.target.value) || 1)}
              />
              {errors.maxBatchesPerDay && (
                <p className="text-xs text-destructive">{errors.maxBatchesPerDay}</p>
              )}
            </div>

            {/* Chemical Base */}
            <div className="space-y-1">
              <Label htmlFor="chemicalBase">Chemical Base</Label>
              <Input
                id="chemicalBase"
                value={form.chemicalBase ?? ""}
                onChange={(e) => setField("chemicalBase", e.target.value || null)}
              />
            </div>

            {/* Sort Order */}
            <div className="space-y-1">
              <Label htmlFor="sortOrder">Sort Order</Label>
              <Input
                id="sortOrder"
                type="number"
                min={0}
                value={form.sortOrder}
                onChange={(e) => setField("sortOrder", Number(e.target.value) || 0)}
              />
            </div>

            {/* Active */}
            <div className="flex items-center gap-2 sm:col-span-2">
              <Switch
                id="active"
                checked={form.active}
                onCheckedChange={(checked) => setField("active", checked)}
              />
              <Label htmlFor="active">Active</Label>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {isEdit ? "Save Changes" : "Create Resource"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
