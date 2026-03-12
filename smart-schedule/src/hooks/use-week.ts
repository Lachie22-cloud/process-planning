import { useState, useCallback, useMemo, useEffect } from "react";
import { useCurrentSite } from "./use-current-site";
import {
  addDays,
  subDays,
  format,
  getDay,
  isSameWeek,
  isValid,
  parseISO,
} from "date-fns";

const WEEK_STORAGE_KEY = "smart-schedule:selected-week";

/**
 * Week navigation hook.
 * Uses the site's configured week_end_day (default Friday = 5).
 * The "week ending" date is the anchor for schedule queries.
 *
 * Persists the selected week in sessionStorage so the date range
 * carries across page navigation within the same browser tab.
 */
export function useWeek() {
  const { site } = useCurrentSite();
  const weekEndDay = site?.weekEndDay ?? 5; // Friday

  const getWeekEnding = useCallback(
    (date: Date): Date => {
      const currentDay = getDay(date); // 0=Sun, 1=Mon... 6=Sat
      const diff = (weekEndDay - currentDay + 7) % 7;
      return addDays(date, diff === 0 ? 0 : diff);
    },
    [weekEndDay],
  );

  // Initialize from sessionStorage if present, otherwise use current week
  const [weekEnding, setWeekEnding] = useState(() => {
    try {
      const stored = sessionStorage.getItem(WEEK_STORAGE_KEY);
      if (stored) {
        const parsed = parseISO(stored);
        if (isValid(parsed)) {
          return getWeekEnding(parsed);
        }
      }
    } catch {
      // sessionStorage unavailable
    }
    return getWeekEnding(new Date());
  });

  // Persist to sessionStorage whenever weekEnding changes
  useEffect(() => {
    try {
      sessionStorage.setItem(WEEK_STORAGE_KEY, format(weekEnding, "yyyy-MM-dd"));
    } catch {
      // sessionStorage unavailable
    }
  }, [weekEnding]);

  const horizonDays = site?.scheduleHorizon ?? 7;

  const weekStart = useMemo(
    () => subDays(weekEnding, horizonDays - 1),
    [weekEnding, horizonDays],
  );

  const nextWeek = useCallback(() => {
    setWeekEnding((prev) => addDays(prev, 7));
  }, []);

  const previousWeek = useCallback(() => {
    setWeekEnding((prev) => subDays(prev, 7));
  }, []);

  const goToThisWeek = useCallback(() => {
    setWeekEnding(getWeekEnding(new Date()));
  }, [getWeekEnding]);

  const goToDate = useCallback(
    (date: Date) => {
      setWeekEnding(getWeekEnding(date));
    },
    [getWeekEnding],
  );

  const isThisWeek = useMemo(
    () =>
      isSameWeek(weekEnding, getWeekEnding(new Date()), {
        weekStartsOn: 1,
      }),
    [weekEnding, getWeekEnding],
  );

  const weekLabel = useMemo(
    () => `${format(weekStart, "EEE d MMM")} — ${format(weekEnding, "EEE d MMM yyyy")}`,
    [weekStart, weekEnding],
  );

  const weekEndingStr = useMemo(
    () => format(weekEnding, "yyyy-MM-dd"),
    [weekEnding],
  );

  return {
    weekEnding,
    weekEndingStr,
    weekStart,
    weekLabel,
    horizonDays,
    isThisWeek,
    nextWeek,
    previousWeek,
    goToThisWeek,
    goToDate,
  };
}
