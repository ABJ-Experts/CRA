import { ZodError } from "zod";
import { ConfigService } from "@nestjs/config";
import {
  diagnosticConfigurationSchema,
  diagnosticPayloadSchema,
} from "@repo/contracts/support-diagnostics";
import type {
  SupportDiagnosticPayload,
  SupportDiagnosticOmission,
} from "@repo/contracts/support-diagnostics";
import { SystemHealthUseCases } from "../../system-health/application/system-health.use-cases";
import { SystemHealthAuthorizationError } from "../../system-health/application/system-health.port";
import {
  projectDiagnosticLogs,
  projectDiagnosticMetrics,
} from "../domain/diagnostic-projector";
import type {
  DiagnosticClaim,
  DiagnosticSourcePort,
} from "../worker/diagnostic-worker.port";
import { DiagnosticWorkerRepositoryAdapter } from "./diagnostic-worker.repository";
export class DiagnosticSourcesAdapter implements DiagnosticSourcePort {
  constructor(
    private readonly repository: DiagnosticWorkerRepositoryAdapter,
    private readonly health: SystemHealthUseCases,
    private readonly config: ConfigService,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async collect(
    claim: DiagnosticClaim,
    signal: AbortSignal,
  ): Promise<SupportDiagnosticPayload> {
    let result: SupportDiagnosticPayload = { omissions: [] };
    for (const category of claim.job.selection.categories) {
      if (signal.aborted) throw new Error("access_changed");
      await this.repository.authorize(claim, signal);
      try {
        if (category === "logs") {
          const source = await this.repository.logs(claim, signal);
          const projected = projectDiagnosticLogs(source.logs);
          result = {
            ...result,
            ...(projected.logs.length === 0 &&
            source.omissions.some(
              (omission) =>
                omission.code === "source_withheld" ||
                omission.code === "source_unavailable",
            )
              ? {}
              : { logs: projected.logs }),
            omissions: [
              ...result.omissions,
              ...source.omissions,
              ...projected.omissions,
            ],
          };
        }
        if (category === "configuration")
          result = {
            ...result,
            configuration: diagnosticConfigurationSchema.parse({
              observedAt: this.now().toISOString(),
              accessTokenSeconds: this.config.getOrThrow<number>(
                "ACCESS_TOKEN_MAX_AGE",
              ),
              refreshTokenSeconds: this.config.getOrThrow<number>(
                "REFRESH_TOKEN_MAX_AGE",
              ),
              smtpTlsMode: this.config.getOrThrow<string>("SMTP_TLS_MODE"),
              maxBundleBytes: 10485760,
              maxLogRows: 5000,
            }),
          };
        if (category === "metrics") {
          const snapshot = await this.health.read(
            claim.job.organizationId,
            claim.creatorUserId,
          );
          result = { ...result, metrics: projectDiagnosticMetrics(snapshot) };
        }
      } catch (error) {
        if (
          error instanceof SystemHealthAuthorizationError ||
          (error instanceof Error && error.message === "access_changed")
        )
          throw new Error("access_changed");
        const omission: SupportDiagnosticOmission = {
          category,
          code:
            error instanceof ZodError ||
            (error instanceof Error && error.message === "invalid_value")
              ? "invalid_value"
              : "source_unavailable",
        };
        result = { ...result, omissions: [...result.omissions, omission] };
      }
    }
    await this.repository.authorize(claim, signal);
    return diagnosticPayloadSchema.parse(result);
  }
}
