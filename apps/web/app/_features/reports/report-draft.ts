import {
  normalizeReportSelection,
  reportSelectionSchema,
} from "@repo/contracts/reports";
import type { ReportSelection } from "@repo/contracts/reports";

const prefix = "cra:scheduled-report-draft:";

/** Keeps a source's current parsed selection out of a long, shareable URL. */
export function storeReportDraftSeed(input: unknown, scope: string): string {
  const report = normalizeReportSelection(input);
  const key = crypto.randomUUID();
  sessionStorage.setItem(`${prefix}${key}`, JSON.stringify({ scope, report }));
  return key;
}

export function readReportDraftSeed(
  key: string | null,
  scope: string,
): ReportSelection | null {
  if (!key || !/^[0-9a-f-]{36}$/i.test(key)) return null;
  const value = sessionStorage.getItem(`${prefix}${key}`);
  if (!value) return null;
  try {
    const record = JSON.parse(value) as { scope?: unknown; report?: unknown };
    if (record.scope !== scope) return null;
    const parsed = reportSelectionSchema.safeParse(record.report);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function clearReportDraftSeed(key: string | null): void {
  if (key && /^[0-9a-f-]{36}$/i.test(key))
    sessionStorage.removeItem(`${prefix}${key}`);
}
