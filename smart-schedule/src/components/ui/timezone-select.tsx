import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { Button } from "@/components/ui/button";
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

interface TimezoneSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}

interface TimezoneEntry {
  tz: string;
  label: string;
  offset: string;
  region: string;
}

function getTimezones(): TimezoneEntry[] {
  const zones = Intl.supportedValuesOf("timeZone");
  const now = Date.now();

  return zones.map((tz) => {
    // Get numeric offset
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    });
    const parts = formatter.formatToParts(now);
    const offsetPart = parts.find((p) => p.type === "timeZoneName");
    const offset = offsetPart?.value ?? "";

    // Region is the first segment (e.g. "Australia" from "Australia/Brisbane")
    const region = tz.includes("/") ? tz.split("/")[0] ?? "Other" : "Other";

    // Friendly label: city part with underscores replaced
    const city = tz.includes("/")
      ? tz.split("/").slice(1).join("/").replace(/_/g, " ")
      : tz;

    return { tz, label: city, offset, region };
  });
}

function formatOffset(offset: string): string {
  // "shortOffset" returns "GMT+10" or "GMT-5" style — keep it compact
  return offset.replace("GMT", "UTC");
}

export function TimezoneSelect({
  value,
  onValueChange,
  disabled,
}: TimezoneSelectProps) {
  const [open, setOpen] = useState(false);
  const timezones = useMemo(() => getTimezones(), []);

  const grouped = useMemo(() => {
    const map = new Map<string, TimezoneEntry[]>();
    for (const entry of timezones) {
      const existing = map.get(entry.region);
      if (existing) existing.push(entry);
      else map.set(entry.region, [entry]);
    }
    return map;
  }, [timezones]);

  const selected = timezones.find((t) => t.tz === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          disabled={disabled}
        >
          {selected ? (
            <span className="truncate">
              {selected.tz}{" "}
              <span className="text-muted-foreground">
                ({formatOffset(selected.offset)})
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">Select timezone...</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search timezone..." />
          <CommandList>
            <CommandEmpty>No timezone found.</CommandEmpty>
            {[...grouped.entries()].map(([region, entries]) => (
              <CommandGroup key={region} heading={region}>
                {entries.map((entry) => (
                  <CommandItem
                    key={entry.tz}
                    value={entry.tz}
                    onSelect={() => {
                      onValueChange(entry.tz);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === entry.tz ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{entry.label}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatOffset(entry.offset)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
