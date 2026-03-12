import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TimezoneSelect } from "@/components/ui/timezone-select";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Save } from "lucide-react";
import { useCurrentSite } from "@/hooks/use-current-site";
import { usePermissions } from "@/hooks/use-permissions";
import { supabase } from "@/lib/supabase/client";

const WEEK_DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function SiteForm() {
  const { site, user } = useCurrentSite();
  const queryClient = useQueryClient();
  const { isSuperAdmin } = usePermissions();
  const canEdit = Boolean(isSuperAdmin);
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Australia/Brisbane");
  const [weekEndDay, setWeekEndDay] = useState("5");
  const [scheduleHorizon, setScheduleHorizon] = useState("7");

  useEffect(() => {
    if (site) {
      setName(site.name);
      setTimezone(site.timezone);
      setWeekEndDay(String(site.weekEndDay));
      setScheduleHorizon(String(site.scheduleHorizon));
    }
  }, [site]);

  const hasChanges = useMemo(
    () =>
      !!site &&
      (name !== site.name ||
        timezone !== site.timezone ||
        weekEndDay !== String(site.weekEndDay) ||
        scheduleHorizon !== String(site.scheduleHorizon)),
    [name, timezone, weekEndDay, scheduleHorizon, site],
  );

  const saveSite = useMutation({
    mutationFn: async () => {
      if (!site) throw new Error("No site selected");
      if (!user || !isSuperAdmin) {
        throw new Error("Only super admins can manage site settings");
      }

      const updates = {
        name: name.trim(),
        timezone: timezone.trim(),
        week_end_day: Number(weekEndDay),
        schedule_horizon: Number(scheduleHorizon),
      };

      const changedFields: Record<string, { from: unknown; to: unknown }> = {};
      if (site.name !== updates.name) {
        changedFields.name = { from: site.name, to: updates.name };
      }
      if (site.timezone !== updates.timezone) {
        changedFields.timezone = { from: site.timezone, to: updates.timezone };
      }
      if (site.weekEndDay !== updates.week_end_day) {
        changedFields.week_end_day = { from: site.weekEndDay, to: updates.week_end_day };
      }
      if (site.scheduleHorizon !== updates.schedule_horizon) {
        changedFields.schedule_horizon = {
          from: site.scheduleHorizon,
          to: updates.schedule_horizon,
        };
      }

      const { error } = await supabase
        .from("sites")
        .update(updates as never)
        .eq("id", site.id);

      if (error) throw error;

      const { error: adminActionError } = await supabase.from("admin_actions").insert({
        site_id: site.id,
        actor_user_id: user.id,
        action: "site.update",
        target_type: "site",
        target_id: site.id,
        metadata: {
          changed_fields: changedFields,
          new_values: updates,
        },
      } as never);

      if (adminActionError) throw adminActionError;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
      if (site?.id) {
        queryClient.invalidateQueries({ queryKey: ["site", site.id] });
        queryClient.invalidateQueries({ queryKey: ["site-settings", site.id] });
      }
    },
  });

  if (!site) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Site Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Site Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} readOnly={!canEdit} />
          </div>
          <div className="space-y-2">
            <Label>Site Code</Label>
            <Input value={site.code} readOnly />
          </div>
          <div className="space-y-2">
            <Label>Timezone</Label>
            {canEdit ? (
              <TimezoneSelect value={timezone} onValueChange={setTimezone} />
            ) : (
              <Input value={timezone} readOnly />
            )}
          </div>
          <div className="space-y-2">
            <Label>Week End Day</Label>
            {canEdit ? (
              <Select value={weekEndDay} onValueChange={setWeekEndDay}>
                <SelectTrigger>
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
            ) : (
              <Input value={WEEK_DAYS[site.weekEndDay] ?? String(site.weekEndDay)} readOnly />
            )}
          </div>
          <div className="space-y-2">
            <Label>Schedule Horizon</Label>
            {canEdit ? (
              <Select value={scheduleHorizon} onValueChange={setScheduleHorizon}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 days (Mon–Fri)</SelectItem>
                  <SelectItem value="6">6 days (Mon–Sat)</SelectItem>
                  <SelectItem value="7">7 days (full week)</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Input value={`${site.scheduleHorizon} days`} readOnly />
            )}
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <div className="flex h-9 items-center">
              <Badge variant={site.active ? "default" : "destructive"}>
                {site.active ? "Active" : "Inactive"}
              </Badge>
            </div>
          </div>
        </div>
        {saveSite.error && (
          <p className="text-xs text-destructive">{saveSite.error.message}</p>
        )}
        {canEdit ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setName(site.name);
                setTimezone(site.timezone);
                setWeekEndDay(String(site.weekEndDay));
                setScheduleHorizon(String(site.scheduleHorizon));
              }}
              disabled={saveSite.isPending || !hasChanges}
            >
              Reset
            </Button>
            <Button
              onClick={() => saveSite.mutate()}
              disabled={saveSite.isPending || !hasChanges || !name.trim() || !timezone.trim()}
            >
              {saveSite.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Settings
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Site settings are read-only in this view.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
