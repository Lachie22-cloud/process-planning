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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/ui/cn";
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
  const [bulkCodeOpen, setBulkCodeOpen] = useState(false);

  useEffect(() => {
    setForm(buildInitialState(alert));
    setError(null);
  }, [alert, open]);

  const sortedBatches = useMemo(
    () => [...batches].sort((a, b) => a.sapOrder.localeCompare(b.sapOrder)),
    [batches],
  );

  const bulkCodeOptions = useMemo(() => {
    const codeMap = new Map<string, number>();
    for (const b of batches) {
      if (b.bulkCode) {
        codeMap.set(b.bulkCode, (codeMap.get(b.bulkCode) ?? 0) + 1);
      }
    }
    return [...codeMap.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [batches]);

  const filteredBatches = useMemo(() => {
    if (!form.bulkCode) return sortedBatches;
    return sortedBatches.filter((b) => b.bulkCode === form.bulkCode);
  }, [sortedBatches, form.bulkCode]);

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
              <Label>Bulk Code</Label>
              <Popover open={bulkCodeOpen} onOpenChange={setBulkCodeOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={bulkCodeOpen}
                    className="w-full justify-between font-normal"
                    disabled={isPending}
                  >
                    {form.bulkCode ? (
                      <span className="truncate font-mono">{form.bulkCode}</span>
                    ) : (
                      <span className="text-muted-foreground">Type or select...</span>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[260px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search bulk code..." />
                    <CommandList>
                      <CommandEmpty>No matching code.</CommandEmpty>
                      <CommandGroup>
                        {form.bulkCode && (
                          <CommandItem
                            value="__clear__"
                            onSelect={() => {
                              setField("bulkCode", "");
                              // Reset batch if it no longer matches
                              if (form.batchId !== "none") {
                                setField("batchId", "none");
                              }
                              setBulkCodeOpen(false);
                            }}
                          >
                            <X className="mr-2 h-4 w-4 text-muted-foreground" />
                            Clear selection
                          </CommandItem>
                        )}
                        {bulkCodeOptions.map((opt) => (
                          <CommandItem
                            key={opt.code}
                            value={opt.code}
                            onSelect={() => {
                              setField("bulkCode", opt.code);
                              // Reset batch if it doesn't match the new bulk code
                              if (form.batchId !== "none") {
                                const matches = batches.some(
                                  (b) => b.id === form.batchId && b.bulkCode === opt.code,
                                );
                                if (!matches) setField("batchId", "none");
                              }
                              setBulkCodeOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                form.bulkCode === opt.code ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <span className="font-mono">{opt.code}</span>
                            <span className="ml-auto text-xs text-muted-foreground">
                              {opt.count} batch{opt.count === 1 ? "" : "es"}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="alert-batch-id">
                Batch{form.bulkCode ? ` (${filteredBatches.length} matching)` : " (optional)"}
              </Label>
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
                  {filteredBatches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.sapOrder}{b.bulkBatchNumber ? ` — ${b.bulkBatchNumber}` : ""}
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
