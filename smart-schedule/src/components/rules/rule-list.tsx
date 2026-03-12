import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import type { ScheduleRule } from "@/types/rule";

interface RuleListProps {
  rules: ScheduleRule[];
  isLoading: boolean;
  canToggle?: boolean;
  onToggle?: (ruleId: string, enabled: boolean) => void;
  onSelect?: (rule: ScheduleRule) => void;
}

export function RuleList({
  rules,
  isLoading,
  canToggle = true,
  onToggle,
  onSelect,
}: RuleListProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No scheduling rules configured. Rules define constraints and
          preferences for the scheduling engine.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Schedule Rules ({rules.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rules.map((rule, i) => (
          <div key={rule.id}>
            {i > 0 && <Separator />}
            <div
              className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-muted/50 cursor-pointer"
              onClick={() => onSelect?.(rule)}
            >
              <Switch
                checked={rule.enabled}
                onCheckedChange={(checked) => onToggle?.(rule.id, checked)}
                onClick={(e) => e.stopPropagation()}
                disabled={!canToggle}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{rule.name}</span>
                  {rule.ruleType && (
                    <Badge variant="outline" className="text-[10px]">
                      {rule.ruleType}
                    </Badge>
                  )}
                  <Badge variant="secondary" className="text-[10px]">
                    v{rule.ruleVersion}
                  </Badge>
                </div>
                {rule.description && (
                  <p className="mt-0.5 text-sm text-muted-foreground truncate">
                    {rule.description}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
