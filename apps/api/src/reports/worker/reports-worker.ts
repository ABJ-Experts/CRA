import { z } from "zod";
import { reportConfigurationSchema } from "@repo/contracts/reports/schemas";
import { resolveReportDateWindow } from "@repo/contracts/reports/policy";
import type { BaseRole } from "@repo/contracts/permissions";
import { sourceSchemaDigest } from "../domain/report-source-digest";
import {
  ExportAccessDeniedError,
  ExportUnavailableError,
} from "../../exports/domain/export.errors";

export const reportRecipientClaimSchema = z
  .object({
    organizationId: z.uuid(),
    recipientId: z.uuid(),
    runId: z.uuid(),
    definitionId: z.uuid(),
    definitionVersion: z.number().int().positive(),
    ownerUserId: z.uuid(),
    userId: z.uuid(),
    ownerBaseRole: z.enum(["viewer", "member", "admin", "owner"]),
    recipientBaseRole: z.enum(["viewer", "member", "admin", "owner"]),
    config: z.unknown(),
    scheduledFor: z.iso.datetime({ offset: true }),
    workerId: z.uuid(),
    version: z.number().int().positive(),
    exportJobId: z.uuid().nullable(),
    sourceSchemaDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type ReportRecipientClaim = z.output<typeof reportRecipientClaimSchema>;

const reportIdentitySchema = z.object({
  report: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("readiness") }),
    z.object({ kind: z.literal("list"), source: z.string() }),
  ]),
});

function mismatchDigest(savedDigest: string): string {
  const zeroDigest = "0".repeat(64);
  return savedDigest === zeroDigest ? "1".repeat(64) : zeroDigest;
}

function currentClaimDigest(claim: ReportRecipientClaim): string {
  const identity = reportIdentitySchema.safeParse(claim.config);
  if (!identity.success) return mismatchDigest(claim.sourceSchemaDigest);
  try {
    return sourceSchemaDigest(identity.data.report);
  } catch {
    return mismatchDigest(claim.sourceSchemaDigest);
  }
}

export interface ReportsWorkerQueue {
  scheduleDue(workerId: string, limit: number): Promise<number>;
  claimRecipient(workerId: string): Promise<ReportRecipientClaim | null>;
  authorizeRecipient(claim: ReportRecipientClaim): Promise<boolean>;
  admitExport(
    claim: ReportRecipientClaim,
    context: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
  publishRecipient(claim: ReportRecipientClaim): Promise<unknown>;
  failRecipient(claim: ReportRecipientClaim, code: string): Promise<unknown>;
  heartbeatRecipient(claim: ReportRecipientClaim): Promise<boolean>;
}
export interface ScheduledSourceContexts {
  prepareScheduled(
    input: Readonly<{
      organizationId: string;
      ownerUserId: string;
      userId: string;
      ownerBaseRole: BaseRole;
      recipientBaseRole: BaseRole;
      requestId: string;
      source: string;
      filters: Readonly<Record<string, unknown>>;
      context: Readonly<Record<string, unknown>>;
    }>,
  ): Promise<Readonly<Record<string, unknown>>>;
}

const knownErrors = new Set([
  "access_changed",
  "provider_unavailable",
  "capture_timeout",
  "export_limit",
  "generation_failed",
  "storage_unavailable",
  "schema_changed",
  "lease_conflict",
]);
export function safeReportWorkerFailure(error: unknown): string {
  if (error instanceof ExportAccessDeniedError) return "access_changed";
  if (error instanceof ExportUnavailableError) return "provider_unavailable";
  return error instanceof Error && knownErrors.has(error.message)
    ? error.message
    : "generation_failed";
}

export class ReportsWorker {
  constructor(
    private readonly queue: ReportsWorkerQueue,
    private readonly exportWorker: Readonly<{
      runOnce(): Promise<"idle" | "processed">;
    }>,
    private readonly sourceContexts: ScheduledSourceContexts,
    private readonly workerId: string,
  ) {}
  async runOnce(): Promise<"idle" | "processed"> {
    await this.queue.scheduleDue(this.workerId, 10);
    const claim = await this.queue.claimRecipient(this.workerId);
    if (!claim) {
      return this.exportWorker.runOnce();
    }
    let pulse = Promise.resolve();
    let pulseFailure: unknown;
    const timer = setInterval(() => {
      pulse = pulse
        .then(async () => {
          if (!(await this.queue.heartbeatRecipient(claim)))
            throw new Error("lease_conflict");
        })
        .catch((error: unknown) => {
          pulseFailure = error;
        });
    }, 30_000);
    timer.unref();
    try {
      if (!(await this.queue.authorizeRecipient(claim)))
        throw new Error("access_changed");
      const currentDigest = currentClaimDigest(claim);
      const config = reportConfigurationSchema.safeParse(claim.config);
      if (currentDigest !== claim.sourceSchemaDigest || !config.success) {
        await this.queue.admitExport(claim, {
          _sourceSchemaDigest:
            currentDigest === claim.sourceSchemaDigest
              ? mismatchDigest(claim.sourceSchemaDigest)
              : currentDigest,
          _resolvedFilters: {},
        });
        return "processed";
      }
      if (claim.exportJobId) {
        const admitted = await this.queue.admitExport(claim, {
          _sourceSchemaDigest: currentDigest,
          _resolvedFilters: {},
        });
        if (!admitted) return "processed";
      } else {
        const report = config.data.report;
        const filters = resolveReportDateWindow(
          config.data,
          claim.scheduledFor,
        );
        const context =
          report.kind === "list"
            ? await this.sourceContexts.prepareScheduled({
                organizationId: claim.organizationId,
                ownerUserId: claim.ownerUserId,
                userId: claim.userId,
                ownerBaseRole: claim.ownerBaseRole,
                recipientBaseRole: claim.recipientBaseRole,
                requestId: claim.recipientId,
                source: report.source,
                filters,
                context: report.context,
              })
            : {};
        const admitted = await this.queue.admitExport(claim, {
          ...context,
          _sourceSchemaDigest: currentDigest,
          _resolvedFilters: filters,
        });
        if (!admitted) return "processed";
      }
      if (!(await this.queue.authorizeRecipient(claim)))
        throw new Error("access_changed");
      await this.exportWorker.runOnce();
      await pulse;
      if (pulseFailure)
        throw pulseFailure instanceof Error
          ? pulseFailure
          : new Error("lease_conflict");
      try {
        await this.queue.publishRecipient(claim);
      } catch (error) {
        if (safeReportWorkerFailure(error) !== "provider_unavailable")
          throw error;
      }
      return "processed";
    } catch (error) {
      if (safeReportWorkerFailure(error) !== "lease_conflict")
        await this.queue.failRecipient(claim, safeReportWorkerFailure(error));
      return "processed";
    } finally {
      clearInterval(timer);
      await pulse;
    }
  }
}
