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
import { TimezoneSelect } from "@/components/ui/timezone-select";
import { Loader2, Save } from "lucide-react";
import { siteFormSchema, type SiteFormInput } from "@/lib/validators/site";
import type { Site } from "@/types/site";

interface SiteAdminFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: Site | null;
  isPending: boolean;
  onSubmit: (data: SiteFormInput & { id?: string }) => void;
}

const WEEK_DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const EMPTY_FORM: SiteFormInput = {
  name: "",
  code: "",
  timezone: "Australia/Brisbane",
  weekEndDay: 5,
  scheduleHorizon: 7,
  active: true,
};

export function SiteAdminForm({
  open,
  onOpenChange,
  site,
  isPending,
  onSubmit,
}: SiteAdminFormProps) {
  const isEdit = !!site;
  const [form, setForm] = useState<SiteFormInput>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      if (site) {
        setForm({
          name: site.name,
          code: site.code,
          timezone: site.timezone,
          weekEndDay: site.weekEndDay,
          scheduleHorizon: site.scheduleHorizon,
          active: site.active,
        });
      } else {
        setForm(EMPTY_FORM);
      }
      setErrors({});
    }
  }, [open, site]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = siteFormSchema.safeParse(form);
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
    onSubmit(isEdit ? { ...result.data, id: site.id } : result.data);
  }

  function setField<K extends keyof SiteFormInput>(key: K, value: SiteFormInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: "" }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit Site" : "Create Site"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update the site configuration."
                : "Create a new factory site."}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {/* Site Name */}
            <div className="space-y-1">
              <Label htmlFor="siteName">Site Name *</Label>
              <Input
                id="siteName"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="e.g. Rocklea"
              />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>

            {/* Site Code */}
            <div className="space-y-1">
              <Label htmlFor="siteCode">Site Code *</Label>
              <Input
                id="siteCode"
                value={form.code}
                onChange={(e) => setField("code", e.target.value.toUpperCase())}
                placeholder="e.g. RKL"
                readOnly={isEdit}
              />
              {errors.code && <p className="text-xs text-destructive">{errors.code}</p>}
            </div>

            {/* Timezone */}
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="timezone">Timezone *</Label>
              <TimezoneSelect
                value={form.timezone}
                onValueChange={(v) => setField("timezone", v)}
              />
              {errors.timezone && (
                <p className="text-xs text-destructive">{errors.timezone}</p>
              )}
            </div>

            {/* Week End Day */}
            <div className="space-y-1">
              <Label htmlFor="weekEndDay">Week End Day</Label>
              <Select
                value={String(form.weekEndDay)}
                onValueChange={(v) => setField("weekEndDay", Number(v))}
              >
                <SelectTrigger id="weekEndDay">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEK_DAYS.map((day, idx) => (
                    <SelectItem key={day} value={String(idx)}>
                      {day}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Schedule Horizon */}
            <div className="space-y-1">
              <Label htmlFor="scheduleHorizon">Schedule Horizon (days)</Label>
              <Select
                value={String(form.scheduleHorizon)}
                onValueChange={(v) => setField("scheduleHorizon", Number(v))}
              >
                <SelectTrigger id="scheduleHorizon">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 days</SelectItem>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="14">14 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Active */}
            <div className="flex items-center gap-2 sm:col-span-2">
              <Switch
                id="siteActive"
                checked={form.active}
                onCheckedChange={(checked) => setField("active", checked)}
              />
              <Label htmlFor="siteActive">Active</Label>
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
              {isEdit ? "Save Changes" : "Create Site"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
