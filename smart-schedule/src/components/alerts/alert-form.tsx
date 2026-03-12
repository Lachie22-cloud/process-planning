import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { bulkAlertFormSchema, type BulkAlertFormInput } from "@/lib/validators/alert";
import type { Batch } from "@/types/batch";
import type { BulkAlert } from "@/types/alert";

interface AlertFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batches: Batch[];
  alert?: BulkAlert | null;
  isPending?: boolean;
  onSubmit: (input: BulkAlertFormInput) => void;
}

interface FormState {
  message: string;
  bulkCode: string;
  batchId: string;
  startDate: string;
  endDate: string;
}

function buildInitialState(alert?: BulkAlert | null): FormState {
  return {
    message: alert?.message ?? "",
    bulkCode: alert?.bulkCode ?? "",
    batchId: alert?.batchId ?? "none",
    startDate: alert?.startDate ?? "",
    endDate: alert?.endDate ?? "",
  };
}

export function AlertForm({
  open,
  onOpenChange,
  batches,
  alert,
  isPending,
  onSubmit,
}: AlertFormProps) {
  const [form, setForm] = useState<FormState>(() => buildInitialState(alert));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(buildInitialState(alert));
    setError(null);
  }, [alert, open]);

  const sortedBatches = useMemo(
    () => [...batches].sort((a, b) => a.sapOrder.localeCompare(b.sapOrder)),
    [batches],
  );

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setForm(buildInitialState(alert));
      setError(null);
    }
    onOpenChange(nextOpen);
  };

  const handleSubmit = () => {
    const parsed = bulkAlertFormSchema.safeParse({
      message: form.message,
      bulkCode: form.bulkCode || null,
      batchId: form.batchId === "none" ? null : form.batchId,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid alert data");
      return;
    }

    setError(null);
    onSubmit(parsed.data);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{alert ? "Edit Alert" : "Create Alert"}</DialogTitle>
          <DialogDescription>
            Configure a date range and message for a bulk alert.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="alert-message">Message</Label>
            <Textarea
              id="alert-message"
              value={form.message}
              onChange={(e) => setField("message", e.target.value)}
              rows={3}
              placeholder="Describe the material issue or instruction"
              disabled={isPending}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="alert-bulk-code">Bulk Code</Label>
              <Input
                id="alert-bulk-code"
                value={form.bulkCode}
                onChange={(e) => setField("bulkCode", e.target.value)}
                placeholder="Optional"
                disabled={isPending}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="alert-batch-id">Batch (optional)</Label>
              <Select
                value={form.batchId}
                onValueChange={(value) => setField("batchId", value)}
                disabled={isPending}
              >
                <SelectTrigger id="alert-batch-id">
                  <SelectValue placeholder="All batches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">All batches</SelectItem>
                  {sortedBatches.map((batch) => (
                    <SelectItem key={batch.id} value={batch.id}>
                      {batch.sapOrder}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Start Date</Label>
              <DatePicker
                value={form.startDate}
                onChange={(v) => setField("startDate", v)}
                placeholder="Select start date"
                disabled={isPending}
              />
            </div>

            <div className="space-y-1.5">
              <Label>End Date</Label>
              <DatePicker
                value={form.endDate}
                onChange={(v) => setField("endDate", v)}
                placeholder="Select end date"
                disabled={isPending}
              />
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {alert ? "Save Alert" : "Create Alert"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
