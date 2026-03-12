import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ShieldAlert, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import {
  useColourGroups,
  useColourTransitions,
  useCreateColourGroup,
  useUpdateColourGroup,
  useDeleteColourGroup,
  useUpsertColourTransition,
  type ColourGroup,
} from "@/hooks/use-colour-groups";
import { cn } from "@/lib/ui/cn";

/* ------------------------------------------------------------------ */
/*  Colour Group Form Dialog                                           */
/* ------------------------------------------------------------------ */

interface GroupFormState {
  code: string;
  name: string;
  hexColour: string;
  sortOrder: number;
  active: boolean;
}

const EMPTY_FORM: GroupFormState = {
  code: "",
  name: "",
  hexColour: "#9ca3af",
  sortOrder: 0,
  active: true,
};

function ColourGroupFormDialog({
  group,
  onClose,
}: {
  group?: ColourGroup;
  onClose: () => void;
}) {
  const [form, setForm] = useState<GroupFormState>(
    group
      ? {
          code: group.code,
          name: group.name,
          hexColour: group.hexColour,
          sortOrder: group.sortOrder,
          active: group.active,
        }
      : EMPTY_FORM,
  );

  const createMutation = useCreateColourGroup();
  const updateMutation = useUpdateColourGroup();
  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = async () => {
    if (!form.code.trim() || !form.name.trim()) return;

    if (group) {
      await updateMutation.mutateAsync({ id: group.id, ...form });
    } else {
      await createMutation.mutateAsync(form);
    }
    onClose();
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{group ? "Edit Colour Group" : "Add Colour Group"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="code">Code</Label>
            <Input
              id="code"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="CGRED"
              disabled={!!group}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="RED"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="colour">Colour</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                id="colour"
                value={form.hexColour}
                onChange={(e) => setForm({ ...form, hexColour: e.target.value })}
                className="h-9 w-12 cursor-pointer rounded border"
              />
              <Input
                value={form.hexColour}
                onChange={(e) => setForm({ ...form, hexColour: e.target.value })}
                className="flex-1"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sortOrder">Sort Order</Label>
            <Input
              id="sortOrder"
              type="number"
              value={form.sortOrder}
              onChange={(e) =>
                setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })
              }
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={form.active}
            onCheckedChange={(active) => setForm({ ...form, active })}
          />
          <Label>Active</Label>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={isSubmitting}>
          {group ? "Save" : "Create"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/* ------------------------------------------------------------------ */
/*  Transition Matrix                                                  */
/* ------------------------------------------------------------------ */

function TransitionMatrix({ groups }: { groups: ColourGroup[] }) {
  const { data: transitions = [] } = useColourTransitions();
  const upsertMutation = useUpsertColourTransition();

  // Build lookup: `${fromId}-${toId}` -> transition
  const transitionMap = new Map(
    transitions.map((t) => [`${t.fromGroupId}-${t.toGroupId}`, t]),
  );

  const handleToggle = (fromId: string, toId: string, field: "allowed" | "requiresWashout") => {
    const key = `${fromId}-${toId}`;
    const existing = transitionMap.get(key);

    if (field === "allowed") {
      upsertMutation.mutate({
        fromGroupId: fromId,
        toGroupId: toId,
        allowed: !(existing?.allowed ?? true),
        requiresWashout: existing?.requiresWashout ?? false,
        washoutMinutes: existing?.washoutMinutes ?? null,
        notes: existing?.notes ?? null,
      });
    } else {
      upsertMutation.mutate({
        fromGroupId: fromId,
        toGroupId: toId,
        allowed: existing?.allowed ?? true,
        requiresWashout: !(existing?.requiresWashout ?? false),
        washoutMinutes: existing?.requiresWashout ? null : 30,
        notes: existing?.notes ?? null,
      });
    }
  };

  const activeGroups = groups.filter((g) => g.active);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Colour Transition Matrix</CardTitle>
        <p className="text-sm text-muted-foreground">
          Configure which colour transitions are allowed between consecutive batches.
          Washout indicates a cleaning step is required.
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="border-b border-r p-2 text-left font-medium text-muted-foreground">
                  From ↓ / To →
                </th>
                {activeGroups.map((g) => (
                  <th key={g.id} className="border-b p-2 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <div
                        className="h-4 w-4 rounded border border-border"
                        style={{ backgroundColor: g.hexColour }}
                      />
                      <span className="font-medium">{g.name}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeGroups.map((from) => (
                <tr key={from.id}>
                  <td className="border-b border-r p-2">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-4 w-4 rounded border border-border"
                        style={{ backgroundColor: from.hexColour }}
                      />
                      <span className="font-medium">{from.name}</span>
                    </div>
                  </td>
                  {activeGroups.map((to) => {
                    if (from.id === to.id) {
                      return (
                        <td
                          key={to.id}
                          className="border-b p-2 text-center bg-muted/50"
                        >
                          <span className="text-muted-foreground">—</span>
                        </td>
                      );
                    }

                    const key = `${from.id}-${to.id}`;
                    const transition = transitionMap.get(key);
                    const allowed = transition?.allowed ?? true;
                    const washout = transition?.requiresWashout ?? false;

                    return (
                      <td key={to.id} className="border-b p-2 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => handleToggle(from.id, to.id, "allowed")}
                                className={cn(
                                  "rounded p-1 transition-colors",
                                  allowed
                                    ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                                    : "bg-red-100 text-red-700 hover:bg-red-200",
                                )}
                              >
                                {allowed ? (
                                  <Check className="h-3 w-3" />
                                ) : (
                                  <X className="h-3 w-3" />
                                )}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {allowed ? "Allowed" : "Blocked"} — click to toggle
                            </TooltipContent>
                          </Tooltip>
                          {allowed && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={() =>
                                    handleToggle(from.id, to.id, "requiresWashout")
                                  }
                                  className={cn(
                                    "rounded px-1 text-[10px] font-medium transition-colors",
                                    washout
                                      ? "bg-amber-100 text-amber-700"
                                      : "bg-muted text-muted-foreground hover:bg-muted/80",
                                  )}
                                >
                                  {washout ? "WASH" : "direct"}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {washout
                                  ? "Washout required — click to remove"
                                  : "No washout — click to require washout"}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export function AdminColourGroupsPage() {
  const { isAdmin } = usePermissions();
  const { data: groups = [], isLoading } = useColourGroups();
  const deleteMutation = useDeleteColourGroup();
  const [editGroup, setEditGroup] = useState<ColourGroup | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!isAdmin) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader
          title="Colour Groups"
          description="Configure colour groups and transition rules for scheduling"
        />
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          <ShieldAlert className="h-10 w-10" />
          <p className="font-medium">Access Denied</p>
          <p className="text-sm">Only site admins can manage colour groups.</p>
        </div>
      </div>
    );
  }

  const handleEdit = (group: ColourGroup) => {
    setEditGroup(group);
    setDialogOpen(true);
  };

  const handleAdd = () => {
    setEditGroup(undefined);
    setDialogOpen(true);
  };

  const handleClose = () => {
    setDialogOpen(false);
    setEditGroup(undefined);
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Colour Groups"
        description="Configure colour groups and transition rules for scheduling"
      />

      {/* Colour Groups Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Colour Groups</CardTitle>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={handleAdd}>
                <Plus className="mr-1 h-4 w-4" /> Add Group
              </Button>
            </DialogTrigger>
            <ColourGroupFormDialog group={editGroup} onClose={handleClose} />
          </Dialog>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Colour</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-20">Order</TableHead>
                  <TableHead className="w-20">Active</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => (
                  <TableRow key={group.id}>
                    <TableCell>
                      <div
                        className="h-6 w-6 rounded border border-border"
                        style={{ backgroundColor: group.hexColour }}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-sm">{group.code}</TableCell>
                    <TableCell>{group.name}</TableCell>
                    <TableCell>{group.sortOrder}</TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "text-xs font-medium",
                          group.active ? "text-emerald-600" : "text-muted-foreground",
                        )}
                      >
                        {group.active ? "Yes" : "No"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleEdit(group)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => {
                            if (confirm(`Delete colour group "${group.name}"?`)) {
                              deleteMutation.mutate(group.id);
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {groups.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No colour groups configured. Click "Add Group" to create one.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Transition Matrix */}
      {groups.length > 0 && <TransitionMatrix groups={groups} />}
    </div>
  );
}
