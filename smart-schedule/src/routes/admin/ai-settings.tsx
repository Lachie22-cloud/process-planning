import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/use-permissions";
import {
  useAiConfig,
  useToggleAiConfig,
  useSetAiCredential,
  useRotateAiCredential,
  useTestAiCredential,
} from "@/hooks/use-ai-config";
import {
  Key,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { Navigate } from "react-router-dom";

const STATUS_CONFIG = {
  valid: { label: "Valid", variant: "default" as const, Icon: ShieldCheck },
  invalid: { label: "Invalid", variant: "destructive" as const, Icon: ShieldAlert },
  expired: { label: "Expired", variant: "destructive" as const, Icon: AlertTriangle },
  unknown: { label: "Unknown", variant: "secondary" as const, Icon: ShieldQuestion },
} as const;

export function AdminAiSettingsPage() {
  const { hasPermission } = usePermissions();
  const { data: config, isLoading } = useAiConfig();
  const toggleConfig = useToggleAiConfig();
  const setCredential = useSetAiCredential();
  const rotateCredential = useRotateAiCredential();
  const testCredential = useTestAiCredential();

  const [credentialDialogOpen, setCredentialDialogOpen] = useState(false);
  const [keyType, setKeyType] = useState<"anthropic_api_key" | "claude_auth_token">(
    "anthropic_api_key",
  );
  const [credentialValue, setCredentialValue] = useState("");

  if (!hasPermission("admin.settings")) {
    return <Navigate to="/admin" replace />;
  }

  const handleSetCredential = () => {
    if (!credentialValue.trim()) return;
    setCredential.mutate(
      { keyType, credential: credentialValue.trim() },
      {
        onSuccess: () => {
          setCredentialDialogOpen(false);
          setCredentialValue("");
        },
      },
    );
  };

  const statusInfo = config
    ? STATUS_CONFIG[config.credentialStatus]
    : null;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="AI Settings"
        description="Configure AI integration credentials and settings"
      />

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Credential Status Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Key className="h-5 w-5" />
                API Credential
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {config ? (
                <>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Type</span>
                      <span className="text-sm font-medium">
                        {config.keyType === "anthropic_api_key"
                          ? "Service API Key"
                          : "Agent Auth Token"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Key</span>
                      <code className="rounded bg-muted px-2 py-1 text-xs font-mono">
                        {config.credentialHint ?? "Not set"}
                      </code>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Status</span>
                      {statusInfo && (
                        <Badge variant={statusInfo.variant} className="gap-1">
                          <statusInfo.Icon className="h-3 w-3" />
                          {statusInfo.label}
                        </Badge>
                      )}
                    </div>
                    {config.credentialLastValidatedAt && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Last Validated</span>
                        <span className="text-sm">
                          {new Date(config.credentialLastValidatedAt).toLocaleString()}
                        </span>
                      </div>
                    )}
                    {config.credentialExpiresAt && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Expires</span>
                        <span className="text-sm">
                          {new Date(config.credentialExpiresAt).toLocaleString()}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Version</span>
                      <span className="text-sm">{config.keyVersion}</span>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => testCredential.mutate()}
                      disabled={testCredential.isPending}
                    >
                      {testCredential.isPending ? (
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <ShieldCheck className="mr-2 h-4 w-4" />
                      )}
                      Test
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => rotateCredential.mutate()}
                      disabled={rotateCredential.isPending}
                    >
                      {rotateCredential.isPending ? (
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-2 h-4 w-4" />
                      )}
                      Rotate
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setKeyType(config.keyType);
                        setCredentialDialogOpen(true);
                      }}
                    >
                      <Key className="mr-2 h-4 w-4" />
                      Update
                    </Button>
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    No AI credential configured for this site. Set one to enable AI features.
                  </p>
                  <Button size="sm" onClick={() => setCredentialDialogOpen(true)}>
                    <Key className="mr-2 h-4 w-4" />
                    Set Credential
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Enable/Disable Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Integration Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">AI Integration</p>
                  <p className="text-sm text-muted-foreground">
                    Enable or disable AI features for this site
                  </p>
                </div>
                <Switch
                  checked={config?.enabled ?? false}
                  onCheckedChange={(checked) => toggleConfig.mutate(checked)}
                  disabled={!config || toggleConfig.isPending}
                />
              </div>
              {config && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Last Updated</span>
                    <span className="text-sm">
                      {new Date(config.updatedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Created</span>
                    <span className="text-sm">
                      {new Date(config.createdAt).toLocaleString()}
                    </span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Set/Rotate Credential Dialog */}
      <Dialog open={credentialDialogOpen} onOpenChange={setCredentialDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {config ? "Update Credential" : "Set AI Credential"}
            </DialogTitle>
            <DialogDescription>
              {config
                ? "Enter a new credential value to replace the existing one."
                : "Configure the AI credential for this site."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Credential Type</Label>
              <Select
                value={keyType}
                onValueChange={(v) => setKeyType(v as typeof keyType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic_api_key">Service API Key</SelectItem>
                  <SelectItem value="claude_auth_token">Agent Auth Token</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Credential</Label>
              <Input
                type="password"
                placeholder={
                  keyType === "anthropic_api_key"
                    ? "API key value..."
                    : "Auth token value..."
                }
                value={credentialValue}
                onChange={(e) => setCredentialValue(e.target.value)}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Credentials are encrypted at rest and never exposed in the frontend.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCredentialDialogOpen(false);
                setCredentialValue("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSetCredential}
              disabled={!credentialValue.trim() || setCredential.isPending}
            >
              {setCredential.isPending ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {config ? "Update" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
