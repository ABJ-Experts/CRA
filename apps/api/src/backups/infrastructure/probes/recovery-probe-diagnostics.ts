import { z } from "zod";
import { RecoveryCheckFailure } from "../restore/isolated-backup-verifier";
export const recoveryProbeDiagnosticCodeSchema = z.enum([
  "storage_file_missing",
  "storage_file_denied",
  "storage_xattr_unavailable",
  "storage_database_permission",
  "storage_database_schema",
  "storage_provider_failure",
  "ready",
  "create_started",
  "verify_started",
  "unexpected_failure",
  "recovery_probe_identity",
  "recovery_probe_authentication",
  "recovery_probe_tenant_isolation",
  "recovery_probe_product_isolation",
  "recovery_probe_evidence_access",
  "recovery_probe_evidence_integrity",
  "recovery_probe_service_unavailable",
  "recovery_probe_destination",
  "recovery_probe_phase",
  "recovery_probe_unexpected_failure",
]);
export const recoveryProbeDiagnosticSchema = z
  .object({
    stage: z.enum(["health", "http", "runtime", "service", "cleanup"]),
    service: z.enum(["auth", "rest", "storage"]).optional(),
    status: z.number().int().min(100).max(599).nullable().optional(),
    running: z.boolean().optional(),
    code: recoveryProbeDiagnosticCodeSchema.optional(),
  })
  .strict();
export type RecoveryProbeDiagnostic = z.output<
  typeof recoveryProbeDiagnosticSchema
>;
export type RecoveryProbeObserver = (event: RecoveryProbeDiagnostic) => void;
export function emitRecoveryProbeDiagnostic(
  observer: RecoveryProbeObserver | undefined,
  event: RecoveryProbeDiagnostic,
): void {
  const parsed = recoveryProbeDiagnosticSchema.safeParse(event);
  if (!parsed.success) return;
  try {
    observer?.(parsed.data);
  } catch {
    /* Diagnostics are best effort and cannot grant or deny recovery authority. */
  }
}
export function traceRecoveryProbe(event: RecoveryProbeDiagnostic): void {
  if (process.env.CRA_BACKUP_PROBE_TRACE !== "true") return;
  process.stderr.write(
    JSON.stringify({ component: "backup_recovery_probe", ...event }) + "\n",
  );
}
export function recoveryProbeFailureCode(error: unknown): string {
  const progress = recoveryProbeFailureProgress(error);
  if (progress)
    return progress.failedCheck === "private_evidence_access"
      ? "recovery_probe_evidence_access"
      : `recovery_probe_${progress.failedCheck}`;
  const known = new Set([
    "recovery_probe_identity",
    "recovery_probe_authentication",
    "recovery_probe_tenant_isolation",
    "recovery_probe_product_isolation",
    "recovery_probe_evidence_access",
    "recovery_probe_evidence_integrity",
    "recovery_probe_service_unavailable",
    "recovery_probe_destination",
    "recovery_probe_phase",
  ]);
  return error instanceof Error && known.has(error.message)
    ? error.message
    : "recovery_probe_unexpected_failure";
}

/** Read only bounded provider diagnostics; never return rejected text, paths or identifiers. */
export function classifyRecoveryStorageFailure(
  source: unknown,
): RecoveryProbeDiagnostic["code"] {
  if (typeof source !== "string") return "storage_provider_failure";
  const text = source.slice(0, 65536);
  if (/\bENOENT\b/.test(text)) return "storage_file_missing";
  if (/\b(?:EACCES|EPERM)\b/.test(text)) return "storage_file_denied";
  if (/\b(?:ENOTSUP|EOPNOTSUPP|ENODATA|ENOATTR|EROFS)\b/.test(text))
    return "storage_xattr_unavailable";
  if (/\b42501\b|permission denied/i.test(text))
    return "storage_database_permission";
  if (/\b(?:42P01|42703)\b/.test(text)) return "storage_database_schema";
  return "storage_provider_failure";
}

const applicationChecks = [
  "authentication",
  "tenant_isolation",
  "product_isolation",
  "private_evidence_access",
] as const;
export const recoveryProbeProgressSchema = z
  .object({
    completedChecks: z.array(z.enum(applicationChecks)).max(3),
    failedCheck: z.enum(applicationChecks),
  })
  .strict()
  .refine(
    (value) =>
      value.completedChecks.every(
        (code, index) => code === applicationChecks[index],
      ) &&
      value.failedCheck === applicationChecks[value.completedChecks.length],
  );
export function recoveryProbeFailureProgress(error: unknown) {
  if (!(error instanceof RecoveryCheckFailure)) return undefined;
  const parsed = recoveryProbeProgressSchema.safeParse({
    completedChecks: error.completedChecks,
    failedCheck: error.failedCheck,
  });
  return parsed.success ? parsed.data : undefined;
}
