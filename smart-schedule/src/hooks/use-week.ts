import { useState, useCallback, useMemo, useEffect } from "react";
import { useCurrentSite } from "./use-current-site";
import { usePermissions } from "./use-permissions";
import {
  addDays,
  subDays,
  format,
  getDay,
  isSameWeek,
  isAfter,
  isValid,
  parseISO,
  isWeekend,
  previousFriday,
  nextMonday,
  isFriday,
  isMonday,
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
  const { hasPermission } = usePermissions();
  const weekEndDay = site?.weekEndDay ?? 5; // Friday

  const canViewFutureWeeks = hasPermission("schedule.view_future");
  const canViewCurrentWeek = hasPermission("schedule.view_current");
  const canViewPastWeeks = hasPermission("schedule.view_past");

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

  const horizonDays = site?.scheduleHorizon ?? 5;

  const weekStart = useMemo(
    () => subDays(weekEnding, horizonDays - 1),
    [weekEnding, horizonDays],
  );

  const currentWeekEnding = useMemo(
    () => getWeekEnding(new Date()),
    [getWeekEnding],
  );

  // Clamp weekEnding based on schedule view permissions
  useEffect(() => {
    const isFutureWeek = isAfter(weekEnding, currentWeekEnding);
    const isPastWeek = !isSameWeek(weekEnding, currentWeekEnding, { weekStartsOn: 1 }) && !isFutureWeek;
    const isCurrentWeek = isSameWeek(weekEnding, currentWeekEnding, { weekStartsOn: 1 });

    if (isFutureWeek && !canViewFutureWeeks) {
      setWeekEnding(currentWeekEnding);
    } else if (isCurrentWeek && !canViewCurrentWeek) {
      // If can't view current, try to go to past or future
      if (canViewPastWeeks) {
        setWeekEnding(subDays(currentWeekEnding, 7));
      } else if (canViewFutureWeeks) {
        setWeekEnding(addDays(currentWeekEnding, 7));
      }
    } else if (isPastWeek && !canViewPastWeeks) {
      setWeekEnding(currentWeekEnding);
    }
  }, [canViewFutureWeeks, canViewCurrentWeek, canViewPastWeeks, weekEnding, currentWeekEnding]);

  const nextWeek = useCallback(() => {
    setWeekEnding((prev) => {
      const next = addDays(prev, 7);
      const nextIsFuture = isAfter(next, currentWeekEnding);
      const nextIsCurrent = isSameWeek(next, currentWeekEnding, { weekStartsOn: 1 });
      if (nextIsFuture && !canViewFutureWeeks) return prev;
      if (nextIsCurrent && !canViewCurrentWeek) {
        // Skip current week if not allowed, jump to future if permitted
        if (canViewFutureWeeks) return addDays(next, 7);
        return prev;
      }
      return next;
    });
  }, [canViewFutureWeeks, canViewCurrentWeek, currentWeekEnding]);

  const previousWeek = useCallback(() => {
    setWeekEnding((prev) => {
      const previous = subDays(prev, 7);
      const previousIsPast = !isSameWeek(previous, currentWeekEnding, { weekStartsOn: 1 }) && !isAfter(previous, currentWeekEnding);
      const previousIsCurrent = isSameWeek(previous, currentWeekEnding, { weekStartsOn: 1 });
      if (previousIsPast && !canViewPastWeeks) return prev;
      if (previousIsCurrent && !canViewCurrentWeek) {
        // Skip current week if not allowed, jump to past if permitted
        if (canViewPastWeeks) return subDays(previous, 7);
        return prev;
      }
      return previous;
    });
  }, [canViewPastWeeks, canViewCurrentWeek, currentWeekEnding]);

  const goToThisWeek = useCallback(() => {
    setWeekEnding(getWeekEnding(new Date()));
  }, [getWeekEnding]);

  const goToDate = useCallback(
    (date: Date) => {
      const target = getWeekEnding(date);
      const targetIsFuture = isAfter(target, currentWeekEnding);
      const targetIsCurrent = isSameWeek(target, currentWeekEnding, { weekStartsOn: 1 });
      const targetIsPast = !targetIsCurrent && !targetIsFuture;

      if (targetIsFuture && !canViewFutureWeeks) {
        if (canViewCurrentWeek) setWeekEnding(currentWeekEnding);
        return;
      }
      if (targetIsCurrent && !canViewCurrentWeek) {
        return;
      }
      if (targetIsPast && !canViewPastWeeks) {
        if (canViewCurrentWeek) setWeekEnding(currentWeekEnding);
        return;
      }
      setWeekEnding(target);
    },
    [getWeekEnding, canViewFutureWeeks, canViewCurrentWeek, canViewPastWeeks, currentWeekEnding],
  );

  const isThisWeek = useMemo(
    () =>
      isSameWeek(weekEnding, getWeekEnding(new Date()), {
        weekStartsOn: 1,
      }),
    [weekEnding, getWeekEnding],
  );

  // For the label, show the first and last shop-floor (non-weekend) days in the range
  const weekLabel = useMemo(() => {
    let displayStart = new Date(weekStart);
    while (isWeekend(displayStart)) {
      displayStart = addDays(displayStart, 1);
    }
    let displayEnd = new Date(weekEnding);
    while (isWeekend(displayEnd)) {
      displayEnd = subDays(displayEnd, 1);
    }
    return `${format(displayStart, "EEE d MMM")} — ${format(displayEnd, "EEE d MMM yyyy")}`;
  }, [weekStart, weekEnding]);

  const weekEndingStr = useMemo(
    () => format(weekEnding, "yyyy-MM-dd"),
    [weekEnding],
  );

  // Extended range: previous Friday before weekStart and next Monday after weekEnding
  // This gives a 7-day view: prev Fri | Mon–Fri | next Mon
  const extendedStart = useMemo(() => {
    let d = new Date(weekStart);
    // Walk back to find the previous Friday (skip weekends in the work-week range)
    while (isWeekend(d)) d = addDays(d, 1);
    // d is now the first weekday (Monday). Get the Friday before it.
    return isFriday(d) ? d : previousFriday(d);
  }, [weekStart]);

  const extendedEnd = useMemo(() => {
    let d = new Date(weekEnding);
    // Walk forward past weekends to find the real last weekday
    while (isWeekend(d)) d = subDays(d, 1);
    // d is now the last weekday (Friday). Get the Monday after it.
    return isMonday(d) ? d : nextMonday(d);
  }, [weekEnding]);

  const extendedStartStr = useMemo(
    () => format(extendedStart, "yyyy-MM-dd"),
    [extendedStart],
  );

  const extendedEndStr = useMemo(
    () => format(extendedEnd, "yyyy-MM-dd"),
    [extendedEnd],
  );

  return {
    weekEnding,
    weekEndingStr,
    weekStart,
    weekLabel,
    horizonDays,
    isThisWeek,
    canViewFutureWeeks,
    canViewCurrentWeek,
    canViewPastWeeks,
    nextWeek,
    previousWeek,
    goToThisWeek,
    goToDate,
    extendedStart,
    extendedEnd,
    extendedStartStr,
    extendedEndStr,
  };
}
