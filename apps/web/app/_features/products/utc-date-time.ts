import { utcZDateTimeSchema } from "@repo/contracts/products";

/** Render UTC wall-clock digits without applying the browser's time zone. */
export function utcDateTimeInputValue(instant: string): string {
  if (!utcZDateTimeSchema.safeParse(instant).success) return "";
  return instant.slice(0, -1);
}

/** Validate the calendar before Date can normalize an impossible day. */
export function utcInstantFromDateTimeInput(value: string): string {
  if (!value) return "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) {
    return value;
  }
  const withSeconds = value.length === 16 ? `${value}:00` : value;
  const parsed = utcZDateTimeSchema.safeParse(`${withSeconds}Z`);
  return parsed.success ? new Date(parsed.data).toISOString() : value;
}
