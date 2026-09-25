import type {
  SbomValidationDiagnostic,
  SbomValidationDiagnosticSeverity,
} from "@repo/contracts/sboms";

export type SbomValidationPolicy = Readonly<{
  maximumBytes: number;
  maximumDepth: number;
  maximumTokens: number;
  maximumScalarBytes: number;
  maximumAttributesPerElement: number;
  maximumTotalAttributeBytes: number;
  maximumDiagnostics: number;
  workerTimeoutMs: number;
}>;

/**
 * Pure validation cannot use wall-clock time without losing byte-for-byte
 * determinism. The ingest worker replaces this marker immediately before the
 * terminal report is durably persisted.
 */
export const DETERMINISTIC_VALIDATION_COMPLETED_AT = "1970-01-01T00:00:00.000Z";

export const VALIDATION_POLICY: SbomValidationPolicy = Object.freeze({
  maximumBytes: 100 * 1024 * 1024,
  maximumDepth: 256,
  maximumTokens: 1_000_000,
  maximumScalarBytes: 1024 * 1024,
  maximumAttributesPerElement: 128,
  maximumTotalAttributeBytes: 64 * 1024,
  maximumDiagnostics: 100,
  workerTimeoutMs: 30_000,
});

const severityRank: Readonly<Record<SbomValidationDiagnosticSeverity, number>> =
  Object.freeze({ error: 0, warning: 1 });

export function diagnostic(
  severity: SbomValidationDiagnosticSeverity,
  code: string,
  location: string,
  message: string,
  remediation: string,
): SbomValidationDiagnostic {
  return Object.freeze({ severity, code, location, message, remediation });
}

/**
 * A single validation run may encounter millions of independent failures.
 * Keep only the first bounded set while retaining a loss counter, rather than
 * building an unbounded intermediate array and slicing it at report time.
 */
export class BoundedDiagnosticCollector {
  private readonly values: SbomValidationDiagnostic[] = [];
  private omitted = 0;
  private errors = 0;
  private warnings = 0;

  constructor(private readonly maximum: number) {}

  push(...diagnostics: readonly SbomValidationDiagnostic[]): number {
    for (const item of diagnostics) {
      if (item.severity === "error") this.errors += 1;
      else this.warnings += 1;
      if (this.values.length < this.maximum) this.values.push(item);
      else this.omitted += 1;
    }
    return this.values.length;
  }

  addOmitted(count: number): void {
    if (Number.isSafeInteger(count) && count > 0) this.omitted += count;
  }

  get length(): number {
    return this.values.length;
  }

  get omittedCount(): number {
    return this.omitted;
  }

  get counts(): Readonly<{ error: number; warning: number }> {
    return Object.freeze({ error: this.errors, warning: this.warnings });
  }

  some(predicate: (value: SbomValidationDiagnostic) => boolean): boolean {
    return this.values.some(predicate);
  }

  toArray(): readonly SbomValidationDiagnostic[] {
    return Object.freeze([...this.values]);
  }
}

export function sortDiagnostics(
  diagnostics: readonly SbomValidationDiagnostic[],
): readonly SbomValidationDiagnostic[] {
  return Object.freeze(
    [...diagnostics].sort(
      (left, right) =>
        left.location.localeCompare(right.location) ||
        severityRank[left.severity] - severityRank[right.severity] ||
        left.code.localeCompare(right.code),
    ),
  );
}

export function countDiagnostics(
  diagnostics: readonly SbomValidationDiagnostic[],
) {
  return Object.freeze({
    error: diagnostics.filter((diagnostic) => diagnostic.severity === "error")
      .length,
    warning: diagnostics.filter(
      (diagnostic) => diagnostic.severity === "warning",
    ).length,
  });
}
