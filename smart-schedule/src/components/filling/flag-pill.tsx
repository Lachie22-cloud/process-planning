import { cn } from "@/lib/ui/cn";
import type { FillingJob } from "./types";

type FlagTone = "bad" | "warn" | "info" | "good" | "neutral";

const FLAG_TONES: Record<string, FlagTone> = {
  "24HR":    "bad",
  OOS:       "bad",
  CRIT:      "bad",
  "48HR":    "warn",
  "LOW COV": "warn",
  WOM:       "warn",
  WOP:       "warn",
  BL:        "info",
  VETTED:    "good",
  RL:        "neutral",
  EXCESS:    "neutral",
  OBS:       "neutral",
  EBR:       "neutral",
};

const TONE_CLS: Record<FlagTone, string> = {
  neutral: "bg-muted text-muted-foreground ring-border",
  good:    "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800",
  warn:    "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800",
  bad:     "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-800",
  info:    "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-800",
};

export function FlagPill({ label }: { label: string }) {
  const tone = FLAG_TONES[label] ?? "neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-[1px] text-[9.5px] font-semibold tracking-wide ring-1 ring-inset",
        TONE_CLS[tone],
      )}
    >
      {label}
    </span>
  );
}

export function FlagWrap({ flags }: { flags: string[] }) {
  if (!flags.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {flags.map((f) => (
        <FlagPill key={f} label={f} />
      ))}
    </span>
  );
}

/** Derive display flags from a real FillingJob in priority order. */
export function getJobFlags(job: FillingJob): string[] {
  const flags: string[] = [];

  // 1. Priority
  if (job.ipt === 1) flags.push("24HR");
  else if (job.ipt === 2) flags.push("48HR");

  // 2. Hold-up reasons (status overrides rmAvailable to avoid duplicate WOM when status is already set)
  if (job.status === "OFF WOM") flags.push("WOM");
  else if (!job.rmAvailable) flags.push("WOM");
  if (job.status === "OFF WOP") flags.push("WOP");
  else if (!job.packagingAvailable) flags.push("WOP");

  // 3. Coverage
  if (job.stockCover !== null && job.stockCover <= 0) flags.push("OOS");
  else if (
    job.stockCover !== null &&
    job.safetyStock !== null &&
    job.stockCover < job.safetyStock
  ) {
    flags.push("LOW COV");
  }

  // 4. Excess
  if (job.excessPaintComment) flags.push("EXCESS");

  // 5. Vetting
  if (job.vettingStatus === "approved") flags.push("VETTED");

  // 6. Quality
  if (job.observationRequired) flags.push("OBS");
  if (job.ebrBatch) flags.push("EBR");

  // 7. Lid types from fill orders
  const lidTypes = new Set(
    job.linkedFillOrders.map((fo) => fo.lidType).filter(Boolean),
  );
  if (lidTypes.has("RL")) flags.push("RL");
  if (lidTypes.has("BL")) flags.push("BL");

  return [...new Set(flags)];
}
