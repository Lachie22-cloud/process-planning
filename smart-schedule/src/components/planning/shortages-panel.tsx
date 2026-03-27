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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PermissionGate } from "@/components/shared/permission-gate";
import { ShieldCheck, CalendarCheck, ArrowUpDown } from "lucide-react";
import {
  useAllBatchShortages,
  useUpdateShortageEta,
} from "@/hooks/use-material-shortages";
import type { BatchShortageRow } from "@/hooks/use-material-shortages";

type SortKey = "material" | "shortQty" | "planDate";
type SortDir = "asc" | "desc";

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
}: {
  rows: BatchShortageRow[];
  materialType: "RM" | "PKG";
}) {
  const updateEta = useUpdateShortageEta();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterMaterial, setFilterMaterial] = useState("");
  const [showOverriddenOnly, setShowOverriddenOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("planDate");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [bulkEta, setBulkEta] = useState("");

  // Unique shortage IDs for each selected batch-shortage row (for ETA update)
  const selectedShortageIds = useMemo(() => {
    const ids = new Set<string>();
    rows.forEach((r) => {
      if (selected.has(r.id)) ids.add(r.shortageId);
    });
    return ids;
  }, [selected, rows]);

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
    selectedShortageIds.forEach((id) => {
      updateEta.mutate({ shortageId: id, eta: bulkEta });
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
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="w-8 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="accent-primary"
                />
              </TableHead>
              <TableHead className="min-w-[180px] py-2">
                <SortButton label="Material" sortKey="material" active={sortKey} dir={sortDir} onClick={toggleSort} />
              </TableHead>
              <TableHead className="w-28 py-2">Batch #</TableHead>
              <TableHead className="w-44 py-2">Bulk Name</TableHead>
              {materialType === "PKG" && <TableHead className="w-28 py-2">Fill Order</TableHead>}
              <TableHead className="w-32 py-2">
                <SortButton label="Sched. Day" sortKey="planDate" active={sortKey} dir={sortDir} onClick={toggleSort} />
              </TableHead>
              <TableHead className="w-28 text-right py-2">
                <SortButton label="Short" sortKey="shortQty" active={sortKey} dir={sortDir} onClick={toggleSort} />
              </TableHead>
              <TableHead className="w-12 py-2">UOM</TableHead>
              <TableHead className="w-28 py-2">ETA</TableHead>
              <TableHead className="w-20 py-2">Override</TableHead>
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
                    <TableCell className="py-1.5">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleRow(row.id)}
                        className="accent-primary"
                      />
                    </TableCell>
                    <TableCell className="py-1.5">
                      <div>
                        <span className="font-mono font-semibold">{row.materialCode}</span>
                        {row.materialDesc && (
                          <p className="text-[11px] text-muted-foreground truncate max-w-[200px]">
                            {row.materialDesc}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-1.5 font-mono">{row.sapOrder ?? "—"}</TableCell>
                    <TableCell className="py-1.5 truncate max-w-[160px]">
                      {row.materialDescription ?? row.bulkCode ?? "—"}
                    </TableCell>
                    {materialType === "PKG" && (
                      <TableCell className="py-1.5 font-mono">{row.fillOrder ?? "—"}</TableCell>
                    )}
                    <TableCell className="py-1.5">{formatDate(row.planDate)}</TableCell>
                    <TableCell className="py-1.5 text-right font-mono font-bold text-red-600 tabular-nums">
                      {row.shortQty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="py-1.5 text-muted-foreground">{row.uom}</TableCell>
                    <TableCell className="py-1.5">
                      <PermissionGate
                        permission="planning.vet"
                        fallback={
                          <span className="text-xs text-muted-foreground">{row.eta ?? "—"}</span>
                        }
                      >
                        <Input
                          type="date"
                          className="h-6 w-28 text-xs"
                          defaultValue={row.eta ?? ""}
                          onBlur={(e) =>
                            updateEta.mutate({ shortageId: row.shortageId, eta: e.target.value || null })
                          }
                        />
                      </PermissionGate>
                    </TableCell>
                    <TableCell className="py-1.5">
                      {overrideActive ? (
                        <Badge
                          variant="secondary"
                          className="gap-1 text-[10px] bg-green-100 text-green-700 border-green-200"
                        >
                          <ShieldCheck className="h-3 w-3" />
                          Override
                        </Badge>
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

  const rmRows = useMemo(() => rows.filter((r) => r.materialType === "RM"), [rows]);
  const pkgRows = useMemo(() => rows.filter((r) => r.materialType === "PKG"), [rows]);

  const rmUnresolved = rmRows.filter((r) => !r.plannerOverride && !r.shortageOverride).length;
  const pkgUnresolved = pkgRows.filter((r) => !r.plannerOverride && !r.shortageOverride).length;

  if (isLoading) return null;
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">Material Shortages</span>
          <span className="text-xs text-muted-foreground">SOH insufficient for requirements</span>
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
            <ShortageTable rows={rmRows} materialType="RM" />
          </TabsContent>
          <TabsContent value="pkg">
            <ShortageTable rows={pkgRows} materialType="PKG" />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
