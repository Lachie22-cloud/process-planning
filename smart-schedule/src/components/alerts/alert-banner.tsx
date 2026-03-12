import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BulkAlert } from "@/types/alert";

interface AlertBannerProps {
  alert: BulkAlert;
  onDismiss?: (id: string) => void;
}

export function AlertBanner({ alert, onDismiss }: AlertBannerProps) {
  return (
    <Alert className="border-border bg-muted/50">
      <AlertTriangle className="h-4 w-4 text-amber-500" />
      <AlertDescription className="flex items-center justify-between gap-2">
        <span className="text-sm">
          <span className="mr-1.5 text-xs font-medium text-muted-foreground">
            Bulk Alert
          </span>
          {alert.bulkCode && (
            <strong className="mr-1">[{alert.bulkCode}]</strong>
          )}
          {alert.message}
        </span>
        {onDismiss && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => onDismiss(alert.id)}
            aria-label="Dismiss alert"
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
