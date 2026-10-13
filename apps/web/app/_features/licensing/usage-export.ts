import { licenseUsageExportResponseSchema } from "@repo/contracts/licensing/schemas";

/** Matches the incumbent audit/export CSV formula and quote escaping policy. */
export function encodeUsageCsvCell(value: string): string {
  const safe = /^[\s\p{Cc}\uFEFF]*[=+\-@]/u.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function serializeUsageExport(input: unknown, format: "json" | "csv") {
  const receipt = licenseUsageExportResponseSchema.parse(input);
  const snapshot = receipt.snapshot;
  const filename = `licence-usage-${snapshot.observedAt.replace(/[:.]/g, "-")}.${format}`;
  if (format === "json")
    return {
      filename,
      mediaType: "application/json",
      content: `${JSON.stringify(receipt, null, 2)}\n`,
    };
  const rows = snapshot.counters.map((counter) => ({
    schemaVersion: snapshot.schemaVersion,
    definitionVersion: snapshot.definitionVersion,
    organizationId: snapshot.organizationId,
    observedAt: snapshot.observedAt,
    reconciledAt: snapshot.reconciledAt,
    meterVersion: snapshot.meterVersion,
    licenseVersion: snapshot.license.version,
    issuanceSequence: snapshot.license.issuanceSequence,
    policyRevision: snapshot.license.policyRevision,
    licenseState: snapshot.license.state,
    licenseVerified: snapshot.license.verified,
    licenseReasons: snapshot.license.reasons.join(";"),
    startsAt: snapshot.license.startsAt,
    expiresAt: snapshot.license.expiresAt,
    graceEndsAt: snapshot.license.graceEndsAt,
    effectiveCapabilities: snapshot.license.effectiveCapabilities.join(";"),
    auditEventId: receipt.auditEventId,
    replayed: receipt.replayed,
    counterId: counter.id,
    label: counter.label,
    definition: counter.definition,
    kind: counter.kind,
    unit: counter.unit,
    scope: counter.scope,
    period: counter.period.kind,
    resetRule: counter.period.resetRule,
    nextResetAt: counter.period.nextResetAt,
    value: counter.value,
    components: JSON.stringify(counter.components),
    availability: counter.availability,
    limitKind: counter.limit.kind,
    limitValue: counter.limit.value,
    state: counter.state,
    reasons: counter.reasons.join(";"),
  }));
  const columns = Object.keys(rows[0]!);
  return {
    filename,
    mediaType: "text/csv;charset=utf-8",
    content: `${[
      columns.map(encodeUsageCsvCell).join(","),
      ...rows.map((row) =>
        Object.values(row)
          .map((value) => encodeUsageCsvCell(String(value)))
          .join(","),
      ),
    ].join("\r\n")}\r\n`,
  };
}
