import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PermissionGate } from "@/components/shared/permission-gate";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  useMaterialShortages,
  useUpdateShortageEta,
  useOverrideMaterialShortage,
} from "@/hooks/use-material-shortages";
import type { MaterialShortage } from "@/types/material-shortage";

export function ShortagesPanel() {
  const { data: shortages = [], isLoading } = useMaterialShortages();
  const updateEta = useUpdateShortageEta();
  const overrideShortage = useOverrideMaterialShortage();

  const [overrideTarget, setOverrideTarget] = useState<MaterialShortage | null>(null);
  const [overrideComment, setOverrideComment] = useState("");
  const [sohConfirmed, setSohConfirmed] = useState(false);
  const [showOverriddenOnly, setShowOverriddenOnly] = useState(false);

  // Only items that are actually short (negative short_qty)
  const activeShortages = shortages.filter((s) => s.shortQty < 0);
  const overriddenShortages = activeShortages.filter((s) => s.plannerOverride);
  const unresolvedShortages = activeShortages.filter((s) => !s.plannerOverride);

  const displayList = showOverriddenOnly ? activeShortages : unresolvedShortages;

  const handleEtaChange = (shortageId: string, eta: string) => {
    updateEta.mutate({ shortageId, eta: eta || null });
  };

  const openOverrideDialog = (shortage: MaterialShortage) => {
    setOverrideTarget(shortage);
    setOverrideComment("");
    setSohConfirmed(false);
  };

  const closeOverrideDialog = () => {
    setOverrideTarget(null);
    setOverrideComment("");
    setSohConfirmed(false);
  };

  const handleOverrideConfirm = () => {
    if (!overrideTarget || !sohConfirmed) return;
    overrideShortage.mutate(
      {
        shortageId: overrideTarget.id,
        override: true,
        comment: overrideComment,
      },
      { onSuccess: closeOverrideDialog },
    );
  };

  const handleRevertOverride = (shortage: MaterialShortage) => {
    overrideShortage.mutate({
      shortageId: shortage.id,
      override: false,
      comment: "Override reverted",
    });
  };

  if (isLoading) return null;
  if (activeShortages.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge variant="destructive" className="px-2 py-0.5 text-xs font-bold">
              {unresolvedShortages.length} SHORTAGES
            </Badge>
            <span className="text-xs text-muted-foreground">
              SOH insufficient for requirements
            </span>
          </div>
          <PermissionGate permission="planning.vet">
            <div className="flex items-center gap-2">
              <Label htmlFor="planner-override-toggle" className="text-xs text-muted-foreground">
                Planner Override
              </Label>
              <Switch
                id="planner-override-toggle"
                checked={showOverriddenOnly}
                onCheckedChange={setShowOverriddenOnly}
              />
            </div>
          </PermissionGate>
        </div>
      </CardHeader>
      <CardContent>
        <div className="max-h-[500px] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[200px]">Material</TableHead>
                <TableHead className="w-16">Type</TableHead>
                <TableHead className="w-28 text-right">Required</TableHead>
                <TableHead className="w-28 text-right">SOH</TableHead>
                <TableHead className="w-28 text-right">Short</TableHead>
                <TableHead className="w-16">UOM</TableHead>
                <TableHead className="w-36">ETA</TableHead>
                {showOverriddenOnly && <TableHead className="w-24">Status</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayList.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={showOverriddenOnly ? 8 : 7} className="py-6 text-center text-sm text-muted-foreground">
                    {showOverriddenOnly
                      ? "No shortages to display."
                      : "All shortages have been resolved or overridden."}
                  </TableCell>
                </TableRow>
              ) : (
                displayList.map((shortage) => (
                  <TableRow
                    key={shortage.id}
                    className={shortage.plannerOverride ? "bg-green-50/30" : "bg-red-50/30"}
                  >
                    <TableCell>
                      <div>
                        <span className="font-mono text-xs font-semibold">
                          {shortage.materialCode}
                        </span>
                        {shortage.materialDesc && (
                          <p className="text-[11px] text-muted-foreground truncate max-w-[260px]">
                            {shortage.materialDesc}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={shortage.materialType === "RM" ? "destructive" : "outline"}
                        className="text-[10px]"
                      >
                        {shortage.materialType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {shortage.requiredQty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {shortage.sohQty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums font-bold text-red-600">
                      {shortage.shortQty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {shortage.uom}
                    </TableCell>
                    <TableCell>
                      <PermissionGate
                        permission="planning.vet"
                        fallback={
                          <span className="text-xs text-muted-foreground">
                            {shortage.eta || "—"}
                          </span>
                        }
                      >
                        <Input
                          type="date"
                          className="h-7 w-32 text-xs"
                          defaultValue={shortage.eta ?? ""}
                          onBlur={(e) => handleEtaChange(shortage.id, e.target.value)}
                          placeholder="dd/mm/yyyy"
                        />
                      </PermissionGate>
                    </TableCell>
                    {showOverriddenOnly && (
                      <TableCell>
                        {shortage.plannerOverride ? (
                          <PermissionGate
                            permission="planning.vet"
                            fallback={
                              <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700">
                                Overridden
                              </Badge>
                            }
                          >
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[10px]"
                              onClick={() => handleRevertOverride(shortage)}
                            >
                              Revert
                            </Button>
                          </PermissionGate>
                        ) : (
                          <PermissionGate permission="planning.vet">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[10px]"
                              onClick={() => openOverrideDialog(shortage)}
                            >
                              Override
                            </Button>
                          </PermissionGate>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Override action row for non-toggle view */}
        {!showOverriddenOnly && unresolvedShortages.length > 0 && (
          <PermissionGate permission="planning.vet">
            <div className="mt-3 flex flex-wrap gap-2">
              {unresolvedShortages.map((s) => (
                <Button
                  key={s.id}
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => openOverrideDialog(s)}
                >
                  <AlertTriangle className="h-3 w-3" />
                  Override {s.materialCode}
                </Button>
              ))}
            </div>
          </PermissionGate>
        )}

        {overriddenShortages.length > 0 && !showOverriddenOnly && (
          <p className="mt-2 text-xs text-muted-foreground">
            {overriddenShortages.length} shortage{overriddenShortages.length !== 1 ? "s" : ""} overridden by planner.
            Toggle &quot;Planner Override&quot; to view.
          </p>
        )}
      </CardContent>

      {/* Override confirmation dialog */}
      <Dialog open={overrideTarget !== null} onOpenChange={(open) => { if (!open) closeOverrideDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Override Material Shortage</DialogTitle>
            <DialogDescription>
              Confirm override for{" "}
              <span className="font-medium">{overrideTarget?.materialCode ?? "—"}</span>
              {overrideTarget?.materialDesc ? ` (${overrideTarget.materialDesc})` : ""}.
              Short by{" "}
              <span className="font-semibold text-red-600">
                {overrideTarget?.shortQty.toLocaleString()} {overrideTarget?.uom}
              </span>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={sohConfirmed}
                onChange={(e) => setSohConfirmed(e.target.checked)}
                className="mt-0.5 accent-primary"
              />
              <span>
                I confirm SOH check has been completed, or stock is in transit to site.
              </span>
            </label>

            <div className="space-y-1">
              <Label htmlFor="shortage-override-comment" className="text-xs">
                Comment (required)
              </Label>
              <Textarea
                id="shortage-override-comment"
                placeholder="e.g. SOH verified on floor — 2 pallets in receiving bay, PO #12345 arriving tomorrow..."
                value={overrideComment}
                onChange={(e) => setOverrideComment(e.target.value)}
                rows={3}
                className="text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeOverrideDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleOverrideConfirm}
              disabled={!sohConfirmed || !overrideComment.trim() || overrideShortage.isPending}
            >
              {overrideShortage.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Confirm Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
