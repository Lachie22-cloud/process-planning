import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowRight, Pencil } from "lucide-react";
import type { SubstitutionRule, SubstitutionConditions } from "@/types/rule";
import type { Resource } from "@/types/resource";

function formatConditions(conditions: SubstitutionConditions): string {
  const parts: string[] = [];
  if (conditions.maxVolume != null) {
    parts.push(`Max volume: ${conditions.maxVolume.toLocaleString()}L`);
  }
  if (conditions.minVolume != null) {
    parts.push(`Min volume: ${conditions.minVolume.toLocaleString()}L`);
  }
  if (conditions.colorGroups?.length) {
    parts.push(`Colour groups: ${conditions.colorGroups.join(", ")}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "No conditions";
}

interface SubstitutionMatrixProps {
  rules: SubstitutionRule[];
  resources: Resource[];
  isLoading: boolean;
  canEdit?: boolean;
  onToggle?: (ruleId: string, enabled: boolean) => void;
  onSelect?: (rule: SubstitutionRule) => void;
}

export function SubstitutionMatrix({
  rules,
  resources,
  isLoading,
  canEdit,
  onToggle,
  onSelect,
}: SubstitutionMatrixProps) {
  const resourceMap = new Map(resources.map((r) => [r.id, r]));

  if (isLoading) {
    return <Skeleton className="h-48 w-full" />;
  }

  if (rules.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No substitution rules configured. Substitution rules define which
          resources can replace others when scheduling.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Substitution Rules ({rules.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              {canEdit && <TableHead className="w-12" />}
              <TableHead>Source</TableHead>
              <TableHead />
              <TableHead>Target</TableHead>
              <TableHead>Conditions</TableHead>
              <TableHead>Status</TableHead>
              {canEdit && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((rule) => {
              const source = rule.sourceResourceId
                ? resourceMap.get(rule.sourceResourceId)
                : null;
              const target = rule.targetResourceId
                ? resourceMap.get(rule.targetResourceId)
                : null;
              return (
                <TableRow key={rule.id}>
                  {canEdit && (
                    <TableCell>
                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={(checked) => onToggle?.(rule.id, checked)}
                      />
                    </TableCell>
                  )}
                  <TableCell className="font-medium">
                    {source?.displayName ?? source?.resourceCode ?? "Any"}
                  </TableCell>
                  <TableCell>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                  <TableCell className="font-medium">
                    {target?.displayName ?? target?.resourceCode ?? "Any"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                    {rule.conditions
                      ? formatConditions(rule.conditions)
                      : "No conditions"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={rule.enabled ? "default" : "secondary"}
                      className="text-[10px]"
                    >
                      {rule.enabled ? "Active" : "Disabled"}
                    </Badge>
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onSelect?.(rule)}
                        aria-label="Edit substitution rule"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
