import { useCurrentSite } from "@/hooks/use-current-site";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function SiteSwitcher() {
  const { site, sites, switchSite } = useCurrentSite();

  if (sites.length <= 1) {
    return (
      <span className="text-sm font-medium text-muted-foreground">
        {site?.name ?? "—"}
      </span>
    );
  }

  return (
    <Select value={site?.id ?? ""} onValueChange={switchSite}>
      <SelectTrigger className="h-8 w-48 text-sm">
        <SelectValue placeholder="Select site" />
      </SelectTrigger>
      <SelectContent>
        {sites.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name} ({s.code})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
