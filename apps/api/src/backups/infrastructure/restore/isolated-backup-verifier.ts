import { performance } from "node:perf_hooks";
import type {
  BackupCertificate,
  BackupEncryptedPart,
  BackupExecutionContext,
  BackupInventory,
  BackupVerificationCheck,
  BackupVerificationRequest,
  BackupVerificationResult,
} from "../../application/backup-execution.port";

export const REQUIRED_RECOVERY_CHECKS = [
  "ciphertext_authentication",
  "manifest_integrity",
  "schema_migrations",
  "extensions",
  "ownership_acl_rls",
  "sequences",
  "object_integrity",
  "audit_continuity",
  "external_keys",
  "credential_quarantine",
  "session_revocation",
  "dataset_markers",
  "authentication",
  "tenant_isolation",
  "product_isolation",
  "private_evidence_access",
  "egress_denied",
  "runtime_compatibility",
] as const;
export type RecoveryCheckCode = (typeof REQUIRED_RECOVERY_CHECKS)[number];
export class RecoveryCheckFailure extends Error {
  constructor(
    readonly failedCheck: RecoveryCheckCode,
    readonly completedChecks: readonly RecoveryCheckCode[],
  ) {
    super("recovery_check_failed");
  }
}

/** Returned only after the independently retained certificate and inventory authenticate. */
export interface AuthenticatedRecovery {
  readonly certificate: BackupCertificate;
  readonly inventory: BackupInventory;
  materialize(
    part: BackupEncryptedPart,
    destination: string,
    signal: AbortSignal,
  ): Promise<void>;
}
export interface IsolatedRecoveryTarget {
  assertIsolated(signal: AbortSignal): Promise<void>;
  restore(recovery: AuthenticatedRecovery, signal: AbortSignal): Promise<void>;
  verifyHistorical(
    recovery: AuthenticatedRecovery,
    signal: AbortSignal,
  ): Promise<readonly string[]>;
  quarantine(signal: AbortSignal): Promise<readonly string[]>;
  probeApplication(signal: AbortSignal): Promise<readonly string[]>;
  destroy(): Promise<void>;
}
export interface RecoveryDependencies {
  maximumDurationMs?(request: BackupVerificationRequest): number;
  openCertified(
    request: BackupVerificationRequest,
    signal: AbortSignal,
  ): Promise<AuthenticatedRecovery>;
  /** Must exclusively create all resources. Existing resources are never adopted. */
  createTarget(
    request: BackupVerificationRequest,
    signal: AbortSignal,
  ): Promise<IsolatedRecoveryTarget>;
}

/** A successful restore command is one step; complete independently measured checks certify. */
export class IsolatedBackupVerifier {
  constructor(private readonly dependencies: RecoveryDependencies) {}

  async verify(
    request: BackupVerificationRequest,
    context: BackupExecutionContext,
  ): Promise<BackupVerificationResult> {
    const started = performance.now();
    let signal = context.signal;
    let target: IsolatedRecoveryTarget | undefined;
    let checks: readonly BackupVerificationCheck[] = [];
    let stage = "manifest_integrity";
    const run = async (
      code: string,
      action: () => Promise<readonly string[] | void>,
    ) => {
      stage = code;
      signal.throwIfAborted();
      await context.assertAuthority();
      const begin = performance.now();
      const completed = await action();
      signal.throwIfAborted();
      const codes = completed ?? [code];
      if (
        !Array.isArray(codes) ||
        new Set(codes).size !== codes.length ||
        codes.some(
          (value: unknown) =>
            typeof value !== "string" ||
            !REQUIRED_RECOVERY_CHECKS.some((required) => required === value) ||
            checks.some((check) => check.code === value),
        )
      )
        throw new Error("recovery_checks_invalid");
      checks = [
        ...checks,
        ...(codes as readonly string[]).map((value) => ({
          code: value,
          status: "passed" as const,
          durationMs: Math.max(0, Math.round(performance.now() - begin)),
        })),
      ];
      await context.checkpoint(
        code,
        Math.min(
          95,
          Math.floor((checks.length / REQUIRED_RECOVERY_CHECKS.length) * 100),
        ),
      );
    };
    try {
      const maximum = this.dependencies.maximumDurationMs?.(request);
      if (maximum !== undefined) {
        if (!Number.isInteger(maximum) || maximum <= 0 || maximum > 14_400_000)
          throw new Error("recovery_deadline_invalid");
        signal = AbortSignal.any([signal, AbortSignal.timeout(maximum)]);
      }
      if (
        request.certificate.instanceId !== request.instanceId ||
        request.certificate.runId !== request.parentRunId ||
        request.certificate.checkpoint.postgresVersion !== "17.6"
      )
        throw new Error("recovery_binding_invalid");
      let recovery: AuthenticatedRecovery | undefined;
      await run("ciphertext_authentication", async () => {
        recovery = await this.dependencies.openCertified(request, signal);
        if (
          recovery.certificate.certificateDigest !==
          request.certificate.certificateDigest
        )
          throw new Error("recovery_certificate_mismatch");
        return ["ciphertext_authentication", "manifest_integrity"];
      });
      stage = "egress_denied";
      target = await this.dependencies.createTarget(request, signal);
      const current = target;
      await run("egress_denied", () => current.assertIsolated(signal));
      await run("runtime_compatibility", () =>
        current.restore(recovery!, signal),
      );
      await run("schema_migrations", () =>
        current.verifyHistorical(recovery!, signal),
      );
      await run("credential_quarantine", () => current.quarantine(signal));
      await run("authentication", () => current.probeApplication(signal));
    } catch (error) {
      if (
        error instanceof RecoveryCheckFailure &&
        REQUIRED_RECOVERY_CHECKS.includes(error.failedCheck) &&
        !checks.some((check) => check.code === error.failedCheck) &&
        new Set(error.completedChecks).size === error.completedChecks.length &&
        !error.completedChecks.includes(error.failedCheck) &&
        error.completedChecks.every(
          (code) =>
            REQUIRED_RECOVERY_CHECKS.includes(code) &&
            !checks.some((check) => check.code === code),
        )
      ) {
        stage = error.failedCheck;
        checks = [
          ...checks,
          ...error.completedChecks.map((code) => ({
            code,
            status: "passed" as const,
            durationMs: 0,
          })),
        ];
      }
      checks = [
        ...checks,
        {
          code: stage,
          status: "failed",
          durationMs: Math.max(0, Math.round(performance.now() - started)),
        },
      ];
    } finally {
      if (target) {
        try {
          await target.destroy();
        } catch {
          checks = [
            ...checks,
            { code: "egress_denied", status: "failed", durationMs: 0 },
          ];
        }
      }
    }
    const verified =
      REQUIRED_RECOVERY_CHECKS.every(
        (code) =>
          checks.filter(
            (check) => check.code === code && check.status === "passed",
          ).length === 1,
      ) && checks.every((check) => check.status === "passed");
    return {
      verified,
      checks: REQUIRED_RECOVERY_CHECKS.map((code) => {
        const matches = checks.filter((check) => check.code === code);
        const failure = matches.find((check) => check.status === "failed");
        return (
          failure ??
          (matches.length === 1
            ? matches[0]!
            : { code, status: "unavailable" as const, durationMs: 0 })
        );
      }),
      durationMs: Math.max(0, Math.round(performance.now() - started)),
      completedAt: new Date().toISOString(),
    };
  }
}
