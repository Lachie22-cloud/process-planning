import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TimezoneSelect } from "@/components/ui/timezone-select";
import { usePermissions } from "@/hooks/use-permissions";
import { useCurrentSite } from "@/hooks/use-current-site";
import { supabase } from "@/lib/supabase/client";
import {
  useAiScheduledTasks,
  useCreateAiTask,
  useUpdateAiTask,
  useDeleteAiTask,
  useToggleAiTask,
  useRunAiTaskNow,
  validateCronExpression,
  describeCron,
  type AiScheduledTask,
  type AiTaskInput,
} from "@/hooks/use-ai-tasks";
import {
  Plus,
  Pencil,
  Trash2,
  Clock,
  RefreshCw,
  Play,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { Navigate } from "react-router-dom";

type TaskType = AiTaskInput["taskType"];
type MisfirePolicy = AiTaskInput["misfirePolicy"];

const TASK_TYPE_LABELS: Record<TaskType, string> = {
  schedule_optimization: "Schedule Optimisation",
  rule_analysis: "Rule Analysis",
  capacity_check: "Capacity Check",
  full_audit: "Full Audit",
};

const MISFIRE_LABELS: Record<NonNullable<MisfirePolicy>, string> = {
  skip_if_missed: "Skip if Missed",
  run_once_on_recovery: "Run Once on Recovery",
};

interface TaskFormState {
  name: string;
  description: string;
  taskType: TaskType;
  cronExpression: string;
  timezone: string;
  misfirePolicy: NonNullable<MisfirePolicy>;
  lockTtlSeconds: number;
  retryMax: number;
  retryBackoffSeconds: number;
  customPrompt: string;
  notifyUserIds: string[];
  enabled: boolean;
}

const DEFAULT_FORM: TaskFormState = {
  name: "",
  description: "",
  taskType: "schedule_optimization",
  cronExpression: "0 6 * * *",
  timezone: "Australia/Brisbane",
  misfirePolicy: "skip_if_missed",
  lockTtlSeconds: 300,
  retryMax: 3,
  retryBackoffSeconds: 60,
  customPrompt: "",
  notifyUserIds: [],
  enabled: false,
};

export function AdminAiScheduledTasksPage() {
  const { site, user } = useCurrentSite();
  const { hasPermission } = usePermissions();
  const { data: tasks, isLoading } = useAiScheduledTasks();
  const createTask = useCreateAiTask();
  const updateTask = useUpdateAiTask();
  const deleteTask = useDeleteAiTask();
  const toggleTask = useToggleAiTask();
  const runNow = useRunAiTaskNow();
  const { data: siteUsers = [] } = useQuery({
    queryKey: ["site_users", site?.id, "ai_task_notify"],
    queryFn: async () => {
      if (!site) return [] as Array<{ id: string; email: string; display_name: string | null }>;
      const { data, error } = await supabase
        .from("site_users")
        .select("id, email, display_name")
        .eq("site_id", site.id)
        .eq("active", true)
        .order("email", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; email: string; display_name: string | null }>;
    },
    enabled: !!site,
  });

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TaskFormState>(DEFAULT_FORM);
  const [deleteTarget, setDeleteTarget] = useState<AiScheduledTask | null>(null);

  if (!hasPermission("admin.settings")) {
    return <Navigate to="/admin" replace />;
  }

  const cronValidation = validateCronExpression(form.cronExpression);

  const openCreate = () => {
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setFormOpen(true);
  };

  const openEdit = (task: AiScheduledTask) => {
    setEditingId(task.id);
    setForm({
      name: task.name,
      description: task.description ?? "",
      taskType: task.taskType,
      cronExpression: task.cronExpression,
      timezone: task.timezone,
      misfirePolicy: task.misfirePolicy,
      lockTtlSeconds: task.lockTtlSeconds,
      retryMax: task.retryMax,
      retryBackoffSeconds: task.retryBackoffSeconds,
      customPrompt: task.customPrompt ?? "",
      notifyUserIds:
        task.notifyUserIds?.length
          ? task.notifyUserIds
          : task.createdBy
            ? [task.createdBy]
            : [],
      enabled: task.enabled,
    });
    setFormOpen(true);
  };

  const handleSubmit = () => {
    if (!form.name.trim() || !cronValidation.valid) return;

    const payload: AiTaskInput = {
      name: form.name,
      description: form.description || null,
      taskType: form.taskType,
      cronExpression: form.cronExpression,
      timezone: form.timezone,
      misfirePolicy: form.misfirePolicy,
      lockTtlSeconds: form.lockTtlSeconds,
      retryMax: form.retryMax,
      retryBackoffSeconds: form.retryBackoffSeconds,
      customPrompt: form.customPrompt || null,
      notifyUserIds: form.notifyUserIds,
      enabled: form.enabled,
    };

    if (editingId) {
      updateTask.mutate(
        { id: editingId, ...payload },
        { onSuccess: () => setFormOpen(false) },
      );
    } else {
      createTask.mutate(payload, {
        onSuccess: () => setFormOpen(false),
      });
    }
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteTask.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
    });
  };

  const isMutating = createTask.isPending || updateTask.isPending;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="AI Scheduled Tasks"
        description="Configure automated AI analysis tasks"
        actions={
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New Task
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : (tasks ?? []).length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Clock className="h-12 w-12 text-muted-foreground/50" />
            <p className="mt-4 text-sm text-muted-foreground">
              No scheduled tasks configured. Create one to automate AI analysis.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tasks</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="hidden md:table-cell">Schedule</TableHead>
                  <TableHead className="hidden lg:table-cell">Last Run</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="w-[100px] text-right">Run</TableHead>
                  <TableHead className="w-[100px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(tasks ?? []).map((task) => (
                  <TableRow key={task.id}>
                    <TableCell>
                      <div>
                        <span className="font-medium">{task.name}</span>
                        {task.description && (
                          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                            {task.description}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {TASK_TYPE_LABELS[task.taskType]}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div>
                        <code className="text-xs">{task.cronExpression}</code>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {describeCron(task.cronExpression)} ({task.timezone})
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {task.lastRunAt ? (
                        <div className="space-y-0.5">
                          <span className="text-sm">
                            {new Date(task.lastRunAt).toLocaleString()}
                          </span>
                          {task.lastError ? (
                            <div className="flex items-center gap-1 text-xs text-destructive">
                              <XCircle className="h-3 w-3" />
                              Error
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-xs text-green-600">
                              <CheckCircle className="h-3 w-3" />
                              {task.lastRunDurationMs != null
                                ? `${(task.lastRunDurationMs / 1000).toFixed(1)}s`
                                : "OK"}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">Never</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={task.enabled}
                        onCheckedChange={(checked) =>
                          toggleTask.mutate({ id: task.id, enabled: checked })
                        }
                        disabled={toggleTask.isPending}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => runNow.mutate(task.id)}
                        disabled={runNow.isPending}
                      >
                        <Play className="h-4 w-4" />
                      </Button>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(task)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(task)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Task" : "New Scheduled Task"}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? "Update the scheduled task configuration."
                : "Create a new automated AI analysis task."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Name & Type */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Daily Schedule Audit"
                />
              </div>
              <div className="space-y-2">
                <Label>Task Type</Label>
                <Select
                  value={form.taskType}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, taskType: v as TaskType }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TASK_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="Optional description of what this task does"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label>Task Prompt (optional)</Label>
              <Textarea
                value={form.customPrompt}
                onChange={(e) =>
                  setForm((f) => ({ ...f, customPrompt: e.target.value }))
                }
                placeholder="If provided, this prompt is used instead of the default scan prompt."
                rows={4}
              />
            </div>

            {/* Cron & Timezone */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Cron Expression</Label>
                <Input
                  value={form.cronExpression}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, cronExpression: e.target.value }))
                  }
                  placeholder="0 6 * * *"
                  className={
                    form.cronExpression && !cronValidation.valid
                      ? "border-destructive"
                      : ""
                  }
                />
                {form.cronExpression && (
                  <p
                    className={`text-xs ${
                      cronValidation.valid
                        ? "text-muted-foreground"
                        : "text-destructive"
                    }`}
                  >
                    {cronValidation.valid
                      ? describeCron(form.cronExpression)
                      : cronValidation.error}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Format: minute hour day-of-month month day-of-week
                </p>
              </div>
              <div className="space-y-2">
                <Label>Timezone</Label>
                <TimezoneSelect
                  value={form.timezone}
                  onValueChange={(v) => setForm((f) => ({ ...f, timezone: v }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Notify Users</Label>
              <div className="max-h-36 space-y-2 overflow-y-auto rounded-md border p-3">
                {siteUsers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No active users found for this site.</p>
                ) : (
                  siteUsers.map((siteUser) => {
                    const checked = form.notifyUserIds.includes(siteUser.id);
                    const label = siteUser.display_name || siteUser.email;
                    return (
                      <label key={siteUser.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setForm((f) => ({
                              ...f,
                              notifyUserIds: e.target.checked
                                ? [...f.notifyUserIds, siteUser.id]
                                : f.notifyUserIds.filter((id) => id !== siteUser.id),
                            }));
                          }}
                        />
                        <span>{label}</span>
                        {user?.id === siteUser.id ? (
                          <span className="text-xs text-muted-foreground">(you)</span>
                        ) : null}
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            {/* Misfire & Retry */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Misfire Policy</Label>
                <Select
                  value={form.misfirePolicy}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      misfirePolicy: v as NonNullable<MisfirePolicy>,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(MISFIRE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Max Retries</Label>
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={form.retryMax}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      retryMax: parseInt(e.target.value, 10) || 0,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Backoff (seconds)</Label>
                <Input
                  type="number"
                  min={10}
                  max={3600}
                  value={form.retryBackoffSeconds}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      retryBackoffSeconds: parseInt(e.target.value, 10) || 60,
                    }))
                  }
                />
              </div>
            </div>

            {/* Lock TTL & Enabled */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Lock TTL (seconds)</Label>
                <Input
                  type="number"
                  min={60}
                  max={3600}
                  value={form.lockTtlSeconds}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      lockTtlSeconds: parseInt(e.target.value, 10) || 300,
                    }))
                  }
                />
              </div>
              <div className="flex items-center gap-3 pt-6">
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(checked) =>
                    setForm((f) => ({ ...f, enabled: checked }))
                  }
                />
                <Label>Enable task immediately</Label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!form.name.trim() || !cronValidation.valid || isMutating}
            >
              {isMutating && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
              {editingId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete Scheduled Task"
        description={`Are you sure you want to delete "${deleteTarget?.name}"? This will also remove all run history for this task.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  );
}
