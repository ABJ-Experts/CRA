import {
  diagnosticLogSchema,
  diagnosticMetricSchema,
} from "@repo/contracts/support-diagnostics";
import type {
  SupportDiagnosticLog,
  SupportDiagnosticMetric,
  SupportDiagnosticOmission,
} from "@repo/contracts/support-diagnostics";
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
/** Construct new closed records; never scrub or recursively serialize raw source data. */
export function projectDiagnosticLogs(rows: readonly unknown[]): {
  logs: SupportDiagnosticLog[];
  omissions: SupportDiagnosticOmission[];
} {
  const parsed = rows.slice(0, 5000).map((value) => {
    const row = record(value);
    return diagnosticLogSchema.safeParse({
      at: row.at,
      source: row.source,
      code: row.code,
      outcome: row.outcome,
    });
  });
  return {
    logs: parsed.flatMap((value) => (value.success ? [value.data] : [])),
    omissions: [
      ...(rows.length > 5000
        ? [{ category: "logs" as const, code: "row_limit" as const }]
        : []),
      ...(parsed.some((row) => !row.success)
        ? [{ category: "logs" as const, code: "invalid_value" as const }]
        : []),
    ],
  };
}
export function projectDiagnosticMetrics(
  snapshot: unknown,
): SupportDiagnosticMetric[] {
  const value = record(snapshot);
  const components = Array.isArray(value.components) ? value.components : [];
  const queues = Array.isArray(value.queues) ? value.queues : [];
  const storage = record(value.storage);
  return [
    ...components.map((item) => {
      const row = record(item);
      return metric(row.id, row);
    }),
    ...queues.map((item) => {
      const row = record(item);
      return metric(row.id, row);
    }),
    metric("storage", { ...storage, storageBytes: storage.customerBytes }),
  ].flatMap((row) => (row === null ? [] : [row]));
}
function metric(
  source: unknown,
  row: Record<string, unknown>,
): SupportDiagnosticMetric | null {
  const parsed = diagnosticMetricSchema.safeParse({
    source,
    status: row.status,
    sourceAt: row.sourceAt ?? null,
    observedAt: row.observedAt ?? null,
    pending: row.pending ?? null,
    running: row.running ?? null,
    failedTerminal: row.failedTerminal ?? null,
    storageBytes: row.storageBytes ?? null,
  });
  return parsed.success ? parsed.data : null;
}
