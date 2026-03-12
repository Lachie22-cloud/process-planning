import { useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "./status-badge";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Package,
  AlertTriangle,
  AlertCircle,
  Eye,
} from "lucide-react";
import { format } from "date-fns";
import type { Batch } from "@/types/batch";
import type { Resource } from "@/types/resource";

interface BatchTableProps {
  batches: Batch[];
  resources: Resource[];
  isLoading: boolean;
  onBatchClick: (batch: Batch) => void;
}

function SortIcon({ sorted }: { sorted: false | "asc" | "desc" }) {
  if (sorted === "asc") return <ArrowUp className="ml-1 inline h-3 w-3" />;
  if (sorted === "desc") return <ArrowDown className="ml-1 inline h-3 w-3" />;
  return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-40" />;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    return format(new Date(dateStr), "EEE d MMM");
  } catch {
    return dateStr;
  }
}

export function BatchTable({
  batches,
  resources,
  isLoading,
  onBatchClick,
}: BatchTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "planDate", desc: false },
  ]);

  const resourceMap = useMemo(() => {
    const map = new Map<string, Resource>();
    for (const r of resources) {
      map.set(r.id, r);
    }
    return map;
  }, [resources]);

  const columns = useMemo<ColumnDef<Batch>[]>(
    () => [
      {
        accessorKey: "status",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Status
            <SortIcon sorted={column.getIsSorted()} />
          </Button>
        ),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
        size: 140,
      },
      {
        accessorKey: "sapOrder",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Batch #
            <SortIcon sorted={column.getIsSorted()} />
          </Button>
        ),
        cell: ({ row }) => (
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => onBatchClick(row.original)}
          >
            {row.original.sapOrder}
          </button>
        ),
        size: 130,
      },
      {
        accessorKey: "materialDescription",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Material Description
            <SortIcon sorted={column.getIsSorted()} />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="max-w-xs truncate text-muted-foreground">
            {row.original.materialDescription ?? "—"}
          </span>
        ),
        size: 260,
      },
      {
        accessorKey: "packSize",
        header: "Pack Size",
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.packSize ?? "—"}
          </span>
        ),
        size: 90,
      },
      {
        accessorKey: "sapColorGroup",
        header: "Colour",
        cell: ({ row }) => {
          const group = row.original.sapColorGroup;
          if (!group) return <span className="text-muted-foreground">—</span>;
          return (
            <span className="text-xs text-muted-foreground">{group}</span>
          );
        },
        size: 100,
      },
      {
        accessorKey: "planDate",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Plan Date
            <SortIcon sorted={column.getIsSorted()} />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {formatDate(row.original.planDate)}
          </span>
        ),
        size: 120,
      },
      {
        id: "resource",
        header: "Resource",
        cell: ({ row }) => {
          const resource = row.original.planResourceId
            ? resourceMap.get(row.original.planResourceId)
            : null;
          return (
            <span className="font-medium">
              {resource?.displayName ?? resource?.resourceCode ?? "Unassigned"}
            </span>
          );
        },
        size: 130,
      },
      {
        accessorKey: "batchVolume",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Volume (L)
            <SortIcon sorted={column.getIsSorted()} />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="font-mono font-semibold tabular-nums">
            {row.original.batchVolume?.toLocaleString() ?? "—"}
          </span>
        ),
        meta: { align: "right" },
        size: 110,
      },
      {
        id: "alerts",
        header: () => <span className="text-center block">Alerts</span>,
        cell: ({ row }) => {
          const batch = row.original;
          const resource = batch.planResourceId
            ? resourceMap.get(batch.planResourceId)
            : null;

          const isWop = !batch.packagingAvailable;
          const isWom = !batch.rmAvailable;
          const isOverCapacity =
            resource &&
            batch.batchVolume != null &&
            resource.maxCapacity != null &&
            batch.batchVolume > resource.maxCapacity;

          if (!isWop && !isWom && !isOverCapacity) {
            return null;
          }

          return (
            <div className="flex items-center justify-center gap-1">
              {isWop && (
                <Tooltip>
                  <TooltipTrigger aria-label="Waiting on packaging">
                    <Package className="h-4 w-4 text-amber-500" />
                  </TooltipTrigger>
                  <TooltipContent>Waiting on Packaging</TooltipContent>
                </Tooltip>
              )}
              {isWom && (
                <Tooltip>
                  <TooltipTrigger aria-label="Waiting on materials">
                    <AlertTriangle className="h-4 w-4 text-orange-500" />
                  </TooltipTrigger>
                  <TooltipContent>Waiting on Materials</TooltipContent>
                </Tooltip>
              )}
              {isOverCapacity && (
                <Tooltip>
                  <TooltipTrigger aria-label="Exceeds mixer capacity">
                    <AlertCircle className="h-4 w-4 text-red-500" />
                  </TooltipTrigger>
                  <TooltipContent>
                    Exceeds mixer capacity ({resource!.maxCapacity?.toLocaleString()}L)
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          );
        },
        size: 80,
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onBatchClick(row.original)}
            aria-label={`View batch ${row.original.sapOrder}`}
          >
            <Eye className="h-4 w-4" />
          </Button>
        ),
        size: 50,
      },
    ],
    [onBatchClick, resourceMap],
  );

  const table = useReactTable({
    data: batches,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  if (isLoading) {
    return (
      <div className="space-y-3 rounded-lg border p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  style={{ width: header.getSize() }}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-24 text-center text-muted-foreground"
              >
                No batches found for this week. Try changing the week or
                filters.
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className="cursor-pointer"
                onClick={() => onBatchClick(row.original)}
                tabIndex={0}
                role="button"
                aria-label={`Open batch ${row.original.sapOrder}`}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onBatchClick(row.original);
                  }
                }}
              >
                {row.getVisibleCells().map((cell) => {
                  const align =
                    (cell.column.columnDef.meta as { align?: string })?.align;
                  return (
                    <TableCell
                      key={cell.id}
                      className={align === "right" ? "text-right" : undefined}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
