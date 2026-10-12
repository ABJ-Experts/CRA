import {
  reportScheduleSchema,
  reportConfigurationSchema,
} from "./schemas/report-input.schema.js";
import type { ReportConfiguration, ReportSchedule } from "./types/index.js";
export type ReportOccurrence = Readonly<{
  scheduledFor: string;
  occurrenceKey: string;
}>;
type CalendarDate = Readonly<{ year: number; month: number; day: number }>;
const dayMs = 86_400_000;
function validInstant(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp))
    throw new Error("Invalid occurrence instant");
  return timestamp;
}
function formatter(timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}
function parts(format: Intl.DateTimeFormat, timestamp: number) {
  const values = Object.fromEntries(
    format
      .formatToParts(new Date(timestamp))
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}
function dayStamp(date: CalendarDate): number {
  return Date.UTC(date.year, date.month - 1, date.day);
}
function addDays(date: CalendarDate, count: number): CalendarDate {
  const value = new Date(dayStamp(date) + count * dayMs);
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}
function dateString(date: CalendarDate): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}
/** Resolve all real instants for the wall clock, then always select the earliest fold. */
function localInstant(
  date: CalendarDate,
  time: string,
  format: Intl.DateTimeFormat,
): number | null {
  const [hour, minute] = time.split(":").map(Number);
  const wall = dayStamp(date) + hour! * 3_600_000 + minute! * 60_000;
  const offsets = Array.from({ length: 17 }, (_, index) => {
    const sample = wall + (index - 8) * 6 * 3_600_000;
    const local = parts(format, sample);
    return (
      Date.UTC(
        local.year,
        local.month - 1,
        local.day,
        local.hour,
        local.minute,
      ) - sample
    );
  });
  const instants = [...new Set(offsets)]
    .map((offset) => wall - offset)
    .filter((candidate) => {
      const local = parts(format, candidate);
      return (
        local.year === date.year &&
        local.month === date.month &&
        local.day === date.day &&
        local.hour === hour &&
        local.minute === minute
      );
    });
  return instants.length ? Math.min(...instants) : null;
}
function eligible(date: CalendarDate, schedule: ReportSchedule): boolean {
  if (schedule.frequency === "daily") return true;
  if (schedule.frequency === "weekly")
    return new Date(dayStamp(date)).getUTCDay() === schedule.weekday;
  const last = new Date(Date.UTC(date.year, date.month, 0)).getUTCDate();
  return date.day === Math.min(schedule.monthDay!, last);
}
function occurrence(
  timestamp: number,
  date: CalendarDate,
  schedule: ReportSchedule,
  format: Intl.DateTimeFormat,
): ReportOccurrence {
  return {
    scheduledFor: new Date(timestamp).toISOString(),
    occurrenceKey: `${format.resolvedOptions().timeZone}:${dateString(date)}T${schedule.localTime}`,
  };
}
/** Strictly after the supplied instant. Gaps produce no occurrence and folds produce one. */
export function nextReportOccurrence(
  input: ReportSchedule | unknown,
  after: string,
): ReportOccurrence {
  const schedule = reportScheduleSchema.parse(input);
  const timestamp = validInstant(after);
  const format = formatter(schedule.timezone);
  const start = parts(format, timestamp);
  for (let index = 0; index < 370; index++) {
    const date = addDays(start, index);
    if (!eligible(date, schedule)) continue;
    const candidate = localInstant(date, schedule.localTime, format);
    if (candidate !== null && candidate > timestamp)
      return occurrence(candidate, date, schedule, format);
  }
  throw new Error("No report occurrence within the bounded calendar horizon");
}
/** At most one catch-up, inclusive now and 24 hours ago. Persisted occurrence keys deduplicate it. */
export function latestReportOccurrence(
  input: ReportSchedule | unknown,
  now: string,
): ReportOccurrence | null {
  const schedule = reportScheduleSchema.parse(input);
  const timestamp = validInstant(now);
  const format = formatter(schedule.timezone);
  const start = parts(format, timestamp);
  const candidates = Array.from({ length: 3 }, (_, index) => {
    const date = addDays(start, -index);
    const candidate = eligible(date, schedule)
      ? localInstant(date, schedule.localTime, format)
      : null;
    return candidate !== null &&
      candidate <= timestamp &&
      candidate >= timestamp - dayMs
      ? occurrence(candidate, date, schedule, format)
      : null;
  }).filter((value): value is ReportOccurrence => value !== null);
  return (
    candidates.sort((a, b) =>
      b.scheduledFor.localeCompare(a.scheduledFor),
    )[0] ?? null
  );
}
function dayBoundary(date: CalendarDate, format: Intl.DateTimeFormat): number {
  // Some zones advance at midnight; the first real clock minute is that day's boundary.
  for (let minute = 0; minute < 1440; minute++) {
    const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    const instant = localInstant(date, time, format);
    if (instant !== null) return instant;
  }
  // A wholly skipped calendar day contributes no elapsed interval.
  return dayBoundary(addDays(date, 1), format);
}
export function resolveReportDateWindow(
  input: ReportConfiguration | unknown,
  scheduledFor: string,
): Record<string, unknown> {
  const config = reportConfigurationSchema.parse(input);
  if (config.report.kind === "readiness") return {};
  if (config.dateWindow.kind === "fixed") return { ...config.report.filters };
  const format = formatter(config.schedule.timezone);
  const end = parts(format, validInstant(scheduledFor));
  const start = addDays(end, -config.dateWindow.days);
  if (config.report.source === "audit.events")
    return {
      ...config.report.filters,
      from: new Date(dayBoundary(start, format)).toISOString(),
      to: new Date(dayBoundary(end, format)).toISOString(),
    };
  return {
    ...config.report.filters,
    from: dateString(start),
    to: dateString(addDays(end, -1)),
    timezone: config.schedule.timezone,
  };
}
