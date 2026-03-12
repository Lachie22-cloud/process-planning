import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "@/hooks/use-current-site";
import type { DatabaseRow } from "@/types/database";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type RbacAuditLogRow = DatabaseRow["rbac_audit_log"];
type SiteUserRow = DatabaseRow["site_users"];

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return format(parsed, "d MMM yyyy, HH:mm:ss");
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function renderMetadataSummary(entry: RbacAuditLogRow): string {
  if (!entry.metadata || typeof entry.metadata !== "object") {
    return "-";
  }

  const metadata = entry.metadata as Record<string, unknown>;
  const previousRoleCodes = asStringArray(metadata.previous_role_codes);
  const newRoleCodes = asStringArray(metadata.new_role_codes);
  const previousPermissionCodes = asStringArray(metadata.previous_permission_codes);
  const newPermissionCodes = asStringArray(metadata.new_permission_codes);

  if (entry.action === "assign_user_roles") {
    return `roles: [${previousRoleCodes.join(", ")}] -> [${newRoleCodes.join(", ")}]`;
  }

  if (entry.action === "update_tenant_role_permissions") {
    return `permissions: ${previousPermissionCodes.length} -> ${newPermissionCodes.length}`;
  }

  return JSON.stringify(metadata);
}

export function RbacAuditLog() {
  const { site } = useCurrentSite();

  const { data: siteUsers = [] } = useQuery<SiteUserRow[]>({
    queryKey: ["site_users", site?.id, "audit_lookup"],
    queryFn: async () => {
      if (!site?.id) {
        return [];
      }

      const { data, error } = await supabase
        .from("site_users")
        .select("*")
        .eq("site_id", site.id)
        .eq("active", true);

      if (error) {
        throw error;
      }

      return data as SiteUserRow[];
    },
    enabled: Boolean(site?.id),
  });

  const { data: entries = [], isLoading, error } = useQuery<RbacAuditLogRow[]>({
    queryKey: ["rbac_audit_log", site?.id],
    queryFn: async () => {
      if (!site?.id) {
        return [];
      }

      const { data, error: queryError } = await supabase
        .from("rbac_audit_log")
        .select("*")
        .eq("site_id", site.id)
        .order("created_at", { ascending: false })
        .limit(100);

      if (queryError) {
        throw queryError;
      }

      return data as RbacAuditLogRow[];
    },
    enabled: Boolean(site?.id),
  });

  const userLookup = useMemo(() => {
    const map = new Map<string, SiteUserRow>();
    for (const siteUser of siteUsers) {
      map.set(siteUser.id, siteUser);
    }
    return map;
  }, [siteUsers]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>RBAC Audit History</CardTitle>
          <CardDescription>Recent permission and assignment changes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 4 }).map((_, idx) => (
            <Skeleton key={idx} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>RBAC Audit History</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Failed to load RBAC audit history</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>RBAC Audit History</CardTitle>
        <CardDescription>Last 100 RBAC actions for this site.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No RBAC audit records found.
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((entry) => {
                  const actor = userLookup.get(entry.actor_user_id);

                  return (
                    <TableRow key={entry.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatTimestamp(entry.created_at)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-[11px]">
                          {entry.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {actor?.display_name ?? actor?.email ?? entry.actor_user_id}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <span className="font-mono">{entry.target_type}</span>
                        {entry.target_id ? `:${entry.target_id}` : ""}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {renderMetadataSummary(entry)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
