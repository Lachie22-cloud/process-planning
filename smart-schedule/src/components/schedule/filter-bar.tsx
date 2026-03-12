import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BATCH_STATUS_LIST } from "@/lib/constants/statuses";
import type { BatchStatus } from "@/types/batch";
import type { Resource } from "@/types/resource";

export interface FilterState {
  search: string;
  status: BatchStatus | "all";
  resourceGroup: string;
}

interface FilterBarProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  resources: Resource[];
}

export function FilterBar({ filters, onFiltersChange, resources }: FilterBarProps) {
  const resourceGroups = [
    ...new Set(resources.map((r) => r.groupName).filter(Boolean)),
  ] as string[];

  const hasActiveFilters =
    filters.search !== "" ||
    filters.status !== "all" ||
    filters.resourceGroup !== "all";

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search batch, bulk code, material..."
          value={filters.search}
          onChange={(e) =>
            onFiltersChange({ ...filters, search: e.target.value })
          }
          className="w-64 pl-9"
        />
      </div>

      <Select
        value={filters.status}
        onValueChange={(value) =>
          onFiltersChange({
            ...filters,
            status: value as BatchStatus | "all",
          })
        }
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="All Statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          {BATCH_STATUS_LIST.map((status) => (
            <SelectItem key={status} value={status}>
              {status}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.resourceGroup}
        onValueChange={(value) =>
          onFiltersChange({ ...filters, resourceGroup: value })
        }
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="All Resource Groups" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Resource Groups</SelectItem>
          {resourceGroups.map((group) => (
            <SelectItem key={group} value={group}>
              {group.replace(/_/g, " ")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="h-9 text-xs"
          onClick={() =>
            onFiltersChange({
              search: "",
              status: "all",
              resourceGroup: "all",
            })
          }
        >
          <X className="mr-1 h-3 w-3" />
          Clear filters
        </Button>
      )}
    </div>
  );
}
