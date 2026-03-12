import { useMemo, useState } from "react";
import { format, isValid } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DateTimePickerProps {
  /** datetime-local string (YYYY-MM-DDTHH:mm) or empty */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function parseDateTimeLocal(value: string): { date: Date | undefined; hour: string; minute: string } {
  if (!value) return { date: undefined, hour: "12", minute: "00" };
  const d = new Date(value);
  if (!isValid(d)) return { date: undefined, hour: "12", minute: "00" };
  return { date: d, hour: pad(d.getHours()), minute: pad(d.getMinutes()) };
}

function toDateTimeLocal(date: Date | undefined, hour: string, minute: string): string {
  if (!date) return "";
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  return `${y}-${m}-${d}T${hour}:${minute}`;
}

const HOURS = Array.from({ length: 24 }, (_, i) => pad(i));
const MINUTES = Array.from({ length: 60 }, (_, i) => pad(i));

export function DateTimePicker({
  value,
  onChange,
  placeholder = "Pick date and time",
  disabled,
  id,
}: DateTimePickerProps) {
  const [open, setOpen] = useState(false);

  const { date: selectedDate, hour, minute } = useMemo(() => parseDateTimeLocal(value), [value]);

  function handleDateSelect(day: Date | undefined) {
    if (day) {
      onChange(toDateTimeLocal(day, hour, minute));
    }
  }

  function handleHourChange(h: string) {
    onChange(toDateTimeLocal(selectedDate, h, minute));
  }

  function handleMinuteChange(m: string) {
    onChange(toDateTimeLocal(selectedDate, hour, m));
  }

  function handleClear() {
    onChange("");
    setOpen(false);
  }

  const displayText = selectedDate
    ? format(selectedDate, "d MMM yyyy") + ` ${hour}:${minute}`
    : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal",
            !displayText && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {displayText ?? placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={handleDateSelect}
          autoFocus
        />
        <div className="flex items-center gap-2 border-t px-3 py-3">
          <Select value={hour} onValueChange={handleHourChange}>
            <SelectTrigger className="w-[70px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-48">
              {HOURS.map((h) => (
                <SelectItem key={h} value={h}>{h}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm font-medium">:</span>
          <Select value={minute} onValueChange={handleMinuteChange}>
            <SelectTrigger className="w-[70px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-48">
              {MINUTES.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto">
            <Button variant="ghost" size="sm" onClick={handleClear}>
              Clear
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
