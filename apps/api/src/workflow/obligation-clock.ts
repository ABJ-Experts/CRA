// Obligation deadline arithmetic (BRD §11, FR-SLA-001/003). All math is in UTC;
// only the presentation layer converts. Regulatory deadlines run in continuous
// elapsed time, and "one month" is CALENDAR-month arithmetic, not 30 days.

export interface Duration {
  hours: number;
  days: number;
  months: number;
}

// Parse the ISO-8601 durations used by the obligation rule set (PT24H, PT72H,
// P14D, P1M). Kept narrow on purpose — the rule set only uses these forms.
export function parseIsoDuration(iso: string): Duration {
  const match = /^P(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?)?$/.exec(iso);
  if (!match || iso === 'P') {
    throw new Error(`Unsupported obligation duration: ${iso}`);
  }
  return {
    months: Number(match[1] ?? 0),
    days: Number(match[2] ?? 0),
    hours: Number(match[3] ?? 0),
  };
}

// Add calendar months, clamping the day to the last day of the target month so
// 31 Jan + 1 month = 28/29 Feb (FR-SLA-003 month-end).
export function addCalendarMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth() + months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const lastDayOfTarget = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  const day = Math.min(date.getUTCDate(), lastDayOfTarget);
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      day,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Compute a stage's due_at from its anchor timestamp and duration. Hours/days are
 * exact elapsed time in UTC (so DST is irrelevant and leap days are handled by the
 * date arithmetic); months use calendar arithmetic.
 */
export function computeDueAt(anchor: Date, isoDuration: string): Date {
  const { hours, days, months } = parseIsoDuration(isoDuration);
  let result = anchor;
  if (months > 0) result = addCalendarMonths(result, months);
  if (days > 0 || hours > 0) {
    result = new Date(result.getTime() + days * DAY_MS + hours * HOUR_MS);
  }
  return result;
}
