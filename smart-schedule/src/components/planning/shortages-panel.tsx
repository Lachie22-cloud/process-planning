import { useState, useMemo } from "react";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PermissionGate } from "@/components/shared/permission-gate";
import { ShieldCheck, CalendarCheck, ArrowUpDown, Loader2 } from "lucide-react";
import {
  useAllBatchShortages,
  useUpdateBatchShortageEta,
  useOverrideBatchShortage,
} from "@/hooks/use-material-shortages";
import type { BatchShortageRow } from "@/hooks/use-material-shortages";

type SortKey = "material" | "shortQty" | "planDate";
type SortDir = "asc" | "desc";

const OVERRIDE_REASONS = [
  "SOH Check Completed",
  "Stock in transit",
  "Stock awaiting GR",
  "Other",
] as const;

type OverrideReason = (typeof OVERRIDE_REASONS)[number];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

function SortButton({
  label,
  sortKey,
  active,
  dir,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
}) {
  return (
    <button
      className="flex items-center gap-1 hover:text-foreground"
      onClick={() => onClick(sortKey)}
    >
      {label}
      <ArrowUpDown
        className={`h-3 w-3 ${active === sortKey ? "text-foreground" : "text-muted-foreground/40"}`}
      />
      {active === sortKey && (
        <span className="text-[10px] text-muted-foreground">{dir === "asc" ? "↑" : "↓"}</span>
      )}
    </button>
  );
}

function ShortageTable({
  rows,
  materialType,
  overrideMode,
  onOverride,
  onRevert,
}: {
  rows: BatchShortageRow[];
  materialType: "RM" | "PKG";
  overrideMode: boolean;
  onOverride: (row: BatchShortageRow) => void;
  onRevert: (row: BatchShortageRow) => void;
}) {
  const updateEta = useUpdateBatchShortageEta();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterMaterial, setFilterMaterial] = useState("");
  const [showOverriddenOnly, setShowOverriddenOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("planDate");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [bulkEta, setBulkEta] = useState("");

  const filtered = useMemo(() => {
    let list = rows;
    if (filterMaterial.trim()) {
      const q = filterMaterial.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.materialCode.toLowerCase().includes(q) ||
          (r.materialDesc ?? "").toLowerCase().includes(q),
      );
    }
    if (showOverriddenOnly) {
      list = list.filter((r) => r.plannerOverride || r.shortageOverride);
    }
    return [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "material") cmp = a.materialCode.localeCompare(b.materialCode);
      else if (sortKey === "shortQty") cmp = a.shortQty - b.shortQty;
      else if (sortKey === "planDate")
        cmp = (a.planDate ?? "").localeCompare(b.planDate ?? "");
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, filterMaterial, showOverriddenOnly, sortKey, sortDir]);

  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => r.id)));
  }

  function applyBulkEta() {
    if (!bulkEta) return;
    selected.forEach((batchShortageId) => {
      updateEta.mutate({ batchShortageId, eta: bulkEta });
    });
    setSelected(new Set());
    setBulkEta("");
  }

  const unresolvedCount = rows.filter((r) => !r.plannerOverride && !r.shortageOverride).length;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Filter by material…"
          value={filterMaterial}
          onChange={(e) => setFilterMaterial(e.target.value)}
          className="h-7 w-48 text-xs"
        />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showOverriddenOnly}
            onChange={(e) => setShowOverriddenOnly(e.target.checked)}
            className="accent-primary"
          />
          Show overrides only
        </label>

        {selected.size > 0 && (
          <PermissionGate permission="planning.vet">
            <div className="ml-auto flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1">
              <CalendarCheck className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                Set ETA for <strong>{selected.size}</strong> selected:
              </span>
              <Input
                type="date"
                value={bulkEta}
                onChange={(e) => setBulkEta(e.target.value)}
                className="h-6 w-32 text-xs"
              />
              <Button
                size="sm"
                className="h-6 px-2 text-xs"
                disabled={!bulkEta || updateEta.isPending}
                onClick={applyBulkEta}
              >
                Apply
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </Button>
            </div>
          </PermissionGate>
        )}

        <div className="ml-auto flex items-center gap-1">
          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
            {unresolvedCount} unresolved
          </Badge>
        </div>
      </div>

      {/* Table */}
      <div className="max-h-[520px] overflow-auto rounded-md border">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="w-9 py-2 px-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="accent-primary"
                />
              </TableHead>
              <TableHead className="w-[160px] py-2 px-2">
                <SortButton label="Material" sortKey="material" active={sortKey} dir={sortDir} onClick={toggleSort} />
              </TableHead>
              <TableHead className="w-[88px] py-2 px-2">Batch #</TableHead>
              <TableHead className="w-[200px] py-2 px-2">Bulk Name</TableHead>
              {materialType === "PKG" && <TableHead className="w-[88px] py-2 px-2">Fill Order</TableHead>}
              <TableHead className="w-[100px] py-2 px-2">
                <SortButton label="Sched. Day" sortKey="planDate" active={sortKey} dir={sortDir} onClick={toggleSort} />
              </TableHead>
              <TableHead className="w-[90px] text-right py-2 px-2">
                <SortButton label="Short" sortKey="shortQty" active={sortKey} dir={sortDir} onClick={toggleSort} />
              </TableHead>
              <TableHead className="w-[40px] py-2 px-2">UOM</TableHead>
              <TableHead className="w-[110px] py-2 px-2">ETA</TableHead>
              <TableHead className="w-[90px] py-2 px-2">Override</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={materialType === "PKG" ? 10 : 9} className="py-6 text-center text-xs text-muted-foreground">
                  No shortages to display.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => {
                const overrideActive = row.plannerOverride || row.shortageOverride;
                return (
                  <TableRow
                    key={row.id}
                    className={
                      overrideActive
                        ? "bg-green-50/30 text-xs"
                        : "bg-red-50/30 text-xs"
                    }
                  >
                    <TableCell className="py-1.5 px-2 w-9">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleRow(row.id)}
                        className="accent-primary"
                      />
                    </TableCell>
                    <TableCell className="py-1.5 px-2 w-[160px]">
                      <div className="truncate">
                        <span className="font-mono font-semibold">{row.materialCode}</span>
                        {row.materialDesc && (
                          <p className="text-[11px] text-muted-foreground truncate">
                            {row.materialDesc}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-1.5 px-2 w-[88px] font-mono">{row.sapOrder ?? "—"}</TableCell>
                    <TableCell className="py-1.5 px-2 w-[200px]">
                      <span className="block truncate">{row.materialDescription ?? row.bulkCode ?? "—"}</span>
                    </TableCell>
                    {materialType === "PKG" && (
                      <TableCell className="py-1.5 px-2 w-[88px] font-mono">{row.fillOrder ?? "—"}</TableCell>
                    )}
                    <TableCell className="py-1.5 px-2 w-[100px] whitespace-nowrap">{formatDate(row.planDate)}</TableCell>
                    <TableCell className="py-1.5 px-2 w-[90px] text-right font-mono font-bold text-red-600 tabular-nums">
                      {row.shortQty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="py-1.5 px-2 w-[40px] text-muted-foreground">{row.uom}</TableCell>
                    <TableCell className="py-1.5 px-2 w-[110px]">
                      <PermissionGate
                        permission="planning.vet"
                        fallback={
                          <span className="text-xs text-muted-foreground">
                            {row.eta ? formatDate(row.eta) : "—"}
                          </span>
                        }
                      >
                        <Input
                          type="date"
                          className="h-6 w-[100px] text-[11px] px-1"
                          defaultValue={row.eta ?? ""}
                          onBlur={(e) =>
                            updateEta.mutate({ batchShortageId: row.id, eta: e.target.value || null })
                          }
                        />
                      </PermissionGate>
                    </TableCell>
                    <TableCell className="py-1.5 px-2 w-[90px]">
                      {overrideActive && overrideMode ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[10px] border-red-200 text-red-600 hover:bg-red-50"
                          onClick={() => onRevert(row)}
                        >
                          Undo
                        </Button>
                      ) : overrideActive ? (
                        <Badge
                          variant="secondary"
                          className="gap-1 text-[10px] bg-green-100 text-green-700 border-green-200"
                        >
                          <ShieldCheck className="h-3 w-3" />
                        </Badge>
                      ) : overrideMode ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => onOverride(row)}
                        >
                          Override
                        </Button>
                      ) : (
                        <span className="text-muted-foreground/40 text-[10px]">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function ShortagesPanel() {
  const { data: rows = [], isLoading } = useAllBatchShortages();
  const overrideMutation = useOverrideBatchShortage();

  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState<BatchShortageRow | null>(null);
  const [selectedReason, setSelectedReason] = useState<OverrideReason | "">("");
  const [overrideComment, setOverrideComment] = useState("");

  const rmRows = useMemo(() => rows.filter((r) => r.materialType === "RM"), [rows]);
  const pkgRows = useMemo(() => rows.filter((r) => r.materialType === "PKG"), [rows]);

  const rmUnresolved = rmRows.filter((r) => !r.plannerOverride && !r.shortageOverride).length;
  const pkgUnresolved = pkgRows.filter((r) => !r.plannerOverride && !r.shortageOverride).length;
  const totalUnresolved = rmUnresolved + pkgUnresolved;

  const closeDialog = () => {
    setOverrideTarget(null);
    setSelectedReason("");
    setOverrideComment("");
  };

  const handleReasonChange = (reason: OverrideReason) => {
    setSelectedReason(reason);
    if (reason === "Other") {
      setOverrideComment("");
    } else {
      setOverrideComment(reason);
    }
  };

  const handleConfirmOverride = () => {
    if (!overrideTarget || !overrideComment.trim()) return;
    overrideMutation.mutate(
      {
        batchShortageId: overrideTarget.id,
        batchId: overrideTarget.batchId,
        override: true,
        comment: overrideComment,
      },
      { onSuccess: closeDialog },
    );
  };

  const handleRevert = (row: BatchShortageRow) => {
    overrideMutation.mutate({
      batchShortageId: row.id,
      batchId: row.batchId,
      override: false,
      comment: "",
    });
  };

  if (isLoading) return null;
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge variant="destructive" className="px-2 py-0.5 text-xs font-bold">
              {totalUnresolved} SHORTAGES
            </Badge>
            <span className="text-xs text-muted-foreground">SOH insufficient for requirements</span>
          </div>
          <PermissionGate permission="planning.vet">
            <div className="flex items-center gap-2">
              <Label htmlFor="planner-override-toggle" className="text-xs text-muted-foreground">
                Planner Override
              </Label>
              <Switch
                id="planner-override-toggle"
                checked={overrideMode}
                onCheckedChange={setOverrideMode}
              />
            </div>
          </PermissionGate>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="rm">
          <TabsList className="mb-3 h-8">
            <TabsTrigger value="rm" className="text-xs gap-1.5">
              Raw Materials
              {rmUnresolved > 0 && (
                <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
                  {rmUnresolved}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="pkg" className="text-xs gap-1.5">
              Packaging
              {pkgUnresolved > 0 && (
                <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
                  {pkgUnresolved}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="rm">
            <ShortageTable rows={rmRows} materialType="RM" overrideMode={overrideMode} onOverride={setOverrideTarget} onRevert={handleRevert} />
          </TabsContent>
          <TabsContent value="pkg">
            <ShortageTable rows={pkgRows} materialType="PKG" overrideMode={overrideMode} onOverride={setOverrideTarget} onRevert={handleRevert} />
          </TabsContent>
        </Tabs>
      </CardContent>

      {/* Override Dialog */}
      <Dialog open={overrideTarget !== null} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Override Shortage</DialogTitle>
            <DialogDescription>
              Override shortage for{" "}
              <span className="font-medium">{overrideTarget?.materialCode ?? "—"}</span>{" "}
              on batch <span className="font-medium">{overrideTarget?.sapOrder ?? "—"}</span>.
              Short by{" "}
              <span className="font-semibold text-red-600">
                {overrideTarget?.shortQty.toLocaleString()} {overrideTarget?.uom}
              </span>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Reason</Label>
              <div className="space-y-2">
                {OVERRIDE_REASONS.map((reason) => (
                  <label key={reason} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="override-reason"
                      value={reason}
                      checked={selectedReason === reason}
                      onChange={() => handleReasonChange(reason)}
                      className="accent-primary"
                    />
                    {reason}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="override-comment" className="text-xs">
                Comment {selectedReason === "Other" && "(required)"}
              </Label>
              <Textarea
                id="override-comment"
                placeholder={
                  selectedReason === "Other"
                    ? "Enter override reason..."
                    : "Add additional details (optional)..."
                }
                value={overrideComment}
                onChange={(e) => setOverrideComment(e.target.value)}
                rows={2}
                className="text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button
              onClick={handleConfirmOverride}
              disabled={!selectedReason || !overrideComment.trim() || overrideMutation.isPending}
            >
              {overrideMutation.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Confirm Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
