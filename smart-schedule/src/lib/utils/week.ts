import { startOfWeek, endOfWeek, addWeeks, format } from "date-fns";

/** Friday-based week: week starts on Friday (ISO day 5) */
const WEEK_START_DAY = 5; // Friday

export function getWeekStart(date: Date): Date {
  return startOfWeek(date, { weekStartsOn: WEEK_START_DAY });
}

export function getWeekEnd(date: Date): Date {
  return endOfWeek(date, { weekStartsOn: WEEK_START_DAY });
}

export function getNextWeek(date: Date): Date {
  return addWeeks(getWeekStart(date), 1);
}

export function getPreviousWeek(date: Date): Date {
  return addWeeks(getWeekStart(date), -1);
}

export function formatWeekLabel(date: Date): string {
  const start = getWeekStart(date);
  const end = getWeekEnd(date);
  return `${format(start, "dd MMM")} – ${format(end, "dd MMM yyyy")}`;
}
