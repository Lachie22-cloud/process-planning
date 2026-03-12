/**
 * Cron expression evaluator with IANA timezone support.
 *
 * Supports standard 5-field cron: minute hour day-of-month month day-of-week
 * Field syntax: * (any), N (specific), N-M (range), * /N (step), N,M,O (list)
 * Day-of-week: 0-7 (0 and 7 = Sunday)
 *
 * Uses Intl.DateTimeFormat for timezone-aware calculations (no external deps).
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CronField {
  values: Set<number>;
}

export interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
  /** Whether the day-of-month field was unrestricted (wildcard *) */
  dayOfMonthIsWildcard: boolean;
  /** Whether the day-of-week field was unrestricted (wildcard *) */
  dayOfWeekIsWildcard: boolean;
}

// ─── Parsing ────────────────────────────────────────────────────────────────

const FIELD_RANGES: readonly [number, number][] = [
  [0, 59],  // minute
  [0, 23],  // hour
  [1, 31],  // day of month
  [1, 12],  // month
  [0, 6],   // day of week (0 = Sunday)
];

/**
 * Parse a single cron field into a set of valid values.
 */
function parseField(field: string, min: number, max: number): CronField {
  const values = new Set<number>();

  for (const part of field.split(',')) {
    const trimmed = part.trim();

    if (trimmed === '*') {
      for (let i = min; i <= max; i++) values.add(i);
      continue;
    }

    // Step: */N or N-M/S
    const stepMatch = trimmed.match(/^(.+)\/(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[2], 10);
      if (step <= 0) throw new Error(`Invalid step: ${step}`);

      let rangeStart = min;
      let rangeEnd = max;

      if (stepMatch[1] !== '*') {
        const rangeParts = stepMatch[1].split('-');
        rangeStart = parseInt(rangeParts[0], 10);
        rangeEnd = rangeParts.length > 1 ? parseInt(rangeParts[1], 10) : max;
      }

      for (let i = rangeStart; i <= rangeEnd; i += step) {
        values.add(i);
      }
      continue;
    }

    // Range: N-M
    const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (start > end) throw new Error(`Invalid range: ${start}-${end}`);
      for (let i = start; i <= end; i++) values.add(i);
      continue;
    }

    // Single value
    const val = parseInt(trimmed, 10);
    if (isNaN(val) || val < min || val > max) {
      throw new Error(`Invalid cron value '${trimmed}' (expected ${min}-${max})`);
    }
    values.add(val);
  }

  return { values };
}

/**
 * Parse a 5-field cron expression string.
 */
export function parseCron(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${fields.length}`);
  }

  // Detect wildcard DOM/DOW before parsing (standard cron OR semantics)
  const domIsWildcard = fields[2].trim() === '*';
  const dowIsWildcard = fields[4].trim() === '*';

  const parsed: ParsedCron = {
    minute: parseField(fields[0], ...FIELD_RANGES[0]),
    hour: parseField(fields[1], ...FIELD_RANGES[1]),
    dayOfMonth: parseField(fields[2], ...FIELD_RANGES[2]),
    month: parseField(fields[3], ...FIELD_RANGES[3]),
    dayOfWeek: parseField(fields[4], ...FIELD_RANGES[4]),
    dayOfMonthIsWildcard: domIsWildcard,
    dayOfWeekIsWildcard: dowIsWildcard,
  };

  // Normalize day-of-week: 7 -> 0 (both mean Sunday)
  if (parsed.dayOfWeek.values.has(7)) {
    parsed.dayOfWeek.values.add(0);
    parsed.dayOfWeek.values.delete(7);
  }

  return parsed;
}

// ─── Timezone Helpers ───────────────────────────────────────────────────────

interface TzComponents {
  year: number;
  month: number;    // 1-12
  day: number;      // 1-31
  hour: number;     // 0-23
  minute: number;   // 0-59
  second: number;   // 0-59
  dayOfWeek: number; // 0-6 (Sunday=0)
}

/**
 * Get date components in a specific IANA timezone.
 * Uses Intl.DateTimeFormat — no external timezone library needed.
 */
function getComponentsInTz(date: Date, timezone: string): TzComponents {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });

  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '0';

  const weekdayStr = get('weekday');
  const dayOfWeekMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10),
    second: parseInt(get('second'), 10),
    dayOfWeek: dayOfWeekMap[weekdayStr] ?? 0,
  };
}

/**
 * Create a Date from components in a specific timezone.
 * Handles DST transitions by searching for the correct UTC offset.
 */
function dateFromTzComponents(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  // Start with a UTC estimate, then adjust for timezone offset
  const estimate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  // Get the offset by comparing the estimate's tz representation
  const tzParts = getComponentsInTz(estimate, timezone);

  // Calculate offset in minutes
  const estimateMinutes = tzParts.hour * 60 + tzParts.minute;
  const targetMinutes = hour * 60 + minute;
  let offsetMinutes = estimateMinutes - targetMinutes;

  // Handle day boundary crossovers
  if (offsetMinutes > 720) offsetMinutes -= 1440;
  if (offsetMinutes < -720) offsetMinutes += 1440;

  const adjusted = new Date(estimate.getTime() + offsetMinutes * 60_000);

  // Verify the result maps back to the expected local time
  const verify = getComponentsInTz(adjusted, timezone);
  if (verify.hour === hour && verify.minute === minute && verify.day === day) {
    return adjusted;
  }

  // DST gap: the requested local time doesn't exist — spring forward
  // Return the next valid minute
  return adjusted;
}

// ─── Next Run Calculation ───────────────────────────────────────────────────

/** Maximum iterations to prevent infinite loops on bad cron expressions */
const MAX_ITERATIONS = 366 * 24 * 60; // ~1 year of minutes

/**
 * Calculate the next run time for a cron expression in a given IANA timezone.
 *
 * @param expression - Standard 5-field cron expression
 * @param timezone - IANA timezone string (e.g., 'Australia/Brisbane')
 * @param after - Find next run after this time (default: now)
 * @returns Next run time as a Date in UTC, or null if no match found
 */
export function getNextRun(
  expression: string,
  timezone: string,
  after?: Date,
): Date | null {
  const cron = parseCron(expression);
  const start = after ?? new Date();

  // Start from the next minute after 'after'
  const startMs = start.getTime() + 60_000;
  const rounded = new Date(startMs - (startMs % 60_000)); // Floor to minute

  let current = rounded;
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    const tz = getComponentsInTz(current, timezone);

    // Check month
    if (!cron.month.values.has(tz.month)) {
      // Skip to next month
      current = dateFromTzComponents(
        tz.month === 12 ? tz.year + 1 : tz.year,
        tz.month === 12 ? 1 : tz.month + 1,
        1, 0, 0,
        timezone,
      );
      continue;
    }

    // Check day of month and day of week — standard cron semantics:
    // When both DOM and DOW are restricted (non-wildcard), match if EITHER matches (OR).
    // When one is a wildcard, only the restricted field is checked (AND, wildcard always true).
    const domMatch = cron.dayOfMonth.values.has(tz.day);
    const dowMatch = cron.dayOfWeek.values.has(tz.dayOfWeek);
    const bothRestricted = !cron.dayOfMonthIsWildcard && !cron.dayOfWeekIsWildcard;
    const dayMatches = bothRestricted
      ? (domMatch || dowMatch)   // OR semantics when both are restricted
      : (domMatch && dowMatch);  // AND semantics (wildcard field always true)

    if (!dayMatches) {
      // Skip to next day
      current = new Date(current.getTime() + 86_400_000);
      const nextDay = getComponentsInTz(current, timezone);
      current = dateFromTzComponents(nextDay.year, nextDay.month, nextDay.day, 0, 0, timezone);
      continue;
    }

    // Check hour
    if (!cron.hour.values.has(tz.hour)) {
      // Skip to next hour
      current = new Date(current.getTime() + 3_600_000);
      const nextHr = getComponentsInTz(current, timezone);
      current = dateFromTzComponents(nextHr.year, nextHr.month, nextHr.day, nextHr.hour, 0, timezone);
      continue;
    }

    // Check minute
    if (!cron.minute.values.has(tz.minute)) {
      current = new Date(current.getTime() + 60_000);
      continue;
    }

    // All fields match — this is the next run time
    return current;
  }

  return null; // No match within search window
}

/**
 * Calculate the previous scheduled run time (for misfire detection).
 *
 * Works backwards from `before` to find the most recent cron match.
 */
export function getPreviousRun(
  expression: string,
  timezone: string,
  before: Date,
): Date | null {
  const cron = parseCron(expression);

  // Start from the minute of 'before'
  const startMs = before.getTime();
  const rounded = new Date(startMs - (startMs % 60_000));

  let current = new Date(rounded.getTime() - 60_000); // Go back 1 minute
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    const tz = getComponentsInTz(current, timezone);

    // Standard cron DOM/DOW semantics (same as getNextRun)
    const domMatch = cron.dayOfMonth.values.has(tz.day);
    const dowMatch = cron.dayOfWeek.values.has(tz.dayOfWeek);
    const bothRestricted = !cron.dayOfMonthIsWildcard && !cron.dayOfWeekIsWildcard;
    const dayMatches = bothRestricted
      ? (domMatch || dowMatch)
      : (domMatch && dowMatch);

    if (
      cron.month.values.has(tz.month) &&
      dayMatches &&
      cron.hour.values.has(tz.hour) &&
      cron.minute.values.has(tz.minute)
    ) {
      return current;
    }

    // Go back by 1 minute
    current = new Date(current.getTime() - 60_000);
  }

  return null;
}

/**
 * Validate that a timezone string is a valid IANA timezone.
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a cron expression string.
 * Returns null if valid, or an error message string.
 */
export function validateCron(expression: string): string | null {
  try {
    parseCron(expression);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Invalid cron expression';
  }
}
