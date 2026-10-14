import { Injectable } from "@nestjs/common";
import { z } from "zod";
import {
  diagnosticJobSchema,
  diagnosticListSchema,
  diagnosticManifestSchema,
  diagnosticGrantSchema,
  diagnosticCleanupReviewSchema,
} from "@repo/contracts/support-diagnostics/schemas";
import type {
  SupportDiagnosticSelection,
  SupportDiagnosticListQuery,
  SupportDiagnosticMutation,
  SupportDiagnosticCleanupInput,
} from "@repo/contracts/support-diagnostics/types";
import type { Database } from "../../supabase/database.types";
import { SupabaseService } from "../../supabase/supabase.service";
import {
  DiagnosticDeniedError,
  DiagnosticConflictError,
  DiagnosticInvalidError,
  DiagnosticUnavailableError,
  type DiagnosticRepository,
  type DiagnosticPrincipal,
} from "../application/diagnostic-repository.port";
const authoritySchema = z.strictObject({
  organizationId: z.uuid(),
  actorUserId: z.uuid(),
  sessionId: z.uuid(),
  permissionVersion: z.string().regex(/^\d+$/),
});
const accessSchema = z
  .strictObject({
    job: diagnosticJobSchema,
    creatorUserId: z.uuid(),
    sessionId: z.uuid(),
    permissionVersion: z.string().regex(/^\d+$/),
    objectPath: z.string().min(1).max(500),
    objectPaths: z.array(z.string().min(1).max(500)).max(3),
    manifest: diagnosticManifestSchema,
  })
  .transform(({ job, objectPath, manifest }) => ({
    job,
    objectPath,
    manifest,
  }));
const envelopeSchema = z.object({
  outcome: z.string(),
  result: z.unknown().optional(),
});
/** RPC arguments are checked against the CLI-generated feature function types. */
type DiagnosticOperation =
  | "authority"
  | "create"
  | "list"
  | "get"
  | "cancel"
  | "access"
  | "revalidate"
  | "issue_grant"
  | "redeem_grant"
  | "cleanup_review"
  | "request_cleanup";
type DiagnosticArgs<O extends DiagnosticOperation> =
  Database["public"]["Functions"][`m15_04_${O}`]["Args"];
type DiagnosticIdentityKeys =
  "p_organization_id" | "p_actor_user_id" | "p_session_id";
@Injectable()
export class SupabaseSupportDiagnosticsRepository implements DiagnosticRepository {
  constructor(private readonly supabase: SupabaseService) {}
  authority(orgId: string, p: DiagnosticPrincipal) {
    return this.call(orgId, p, "authority", {}, authoritySchema);
  }
  create(
    orgId: string,
    p: DiagnosticPrincipal,
    selection: SupportDiagnosticSelection,
    previewDigest: string,
    idempotencyKey: string,
  ) {
    return this.call(
      orgId,
      p,
      "create",
      {
        p_selection: selection,
        p_preview_digest: previewDigest,
        p_idempotency_key: idempotencyKey,
      },
      diagnosticJobSchema,
    );
  }
  list(
    orgId: string,
    p: DiagnosticPrincipal,
    query: SupportDiagnosticListQuery,
  ) {
    return this.call(
      orgId,
      p,
      "list",
      {
        ...(query.cursor ? { p_after_id: query.cursor } : {}),
        p_limit: query.limit,
      },
      diagnosticListSchema,
    );
  }
  get(orgId: string, p: DiagnosticPrincipal, jobId: string) {
    return this.call(orgId, p, "get", { p_job_id: jobId }, diagnosticJobSchema);
  }
  cancel(
    orgId: string,
    p: DiagnosticPrincipal,
    jobId: string,
    input: SupportDiagnosticMutation,
  ) {
    return this.call(
      orgId,
      p,
      "cancel",
      {
        p_job_id: jobId,
        p_expected_version: input.expectedVersion,
        p_idempotency_key: input.idempotencyKey,
      },
      diagnosticJobSchema,
    );
  }
  access(
    orgId: string,
    p: DiagnosticPrincipal,
    jobId: string,
    requestId: string,
  ) {
    return this.call(
      orgId,
      p,
      "access",
      { p_job_id: jobId, p_request_id: requestId },
      accessSchema,
    );
  }
  revalidate(
    orgId: string,
    p: DiagnosticPrincipal,
    jobId: string,
    requestId: string,
  ) {
    return this.call(
      orgId,
      p,
      "revalidate",
      { p_job_id: jobId, p_request_id: requestId },
      accessSchema,
    );
  }
  grant(
    orgId: string,
    p: DiagnosticPrincipal,
    jobId: string,
    input: SupportDiagnosticMutation,
    grantId: string,
    grantDigest: string,
  ) {
    return this.call(
      orgId,
      p,
      "issue_grant",
      {
        p_job_id: jobId,
        p_expected_version: input.expectedVersion,
        p_grant_id: grantId,
        p_grant_digest: grantDigest,
        p_idempotency_key: input.idempotencyKey,
      },
      diagnosticGrantSchema,
    );
  }
  redeem(
    orgId: string,
    p: DiagnosticPrincipal,
    jobId: string,
    grantId: string,
    grantDigest: string,
    requestId: string,
  ) {
    return this.call(
      orgId,
      p,
      "redeem_grant",
      {
        p_job_id: jobId,
        p_grant_id: grantId,
        p_grant_digest: grantDigest,
        p_request_id: requestId,
      },
      accessSchema,
    );
  }
  cleanupReview(orgId: string, p: DiagnosticPrincipal, jobId: string) {
    return this.call(
      orgId,
      p,
      "cleanup_review",
      { p_job_id: jobId },
      diagnosticCleanupReviewSchema,
    );
  }
  cleanup(
    orgId: string,
    p: DiagnosticPrincipal,
    jobId: string,
    input: SupportDiagnosticCleanupInput,
  ) {
    return this.call(
      orgId,
      p,
      "request_cleanup",
      {
        p_job_id: jobId,
        p_expected_version: input.expectedVersion,
        p_review_fingerprint: input.reviewFingerprint,
        p_idempotency_key: input.idempotencyKey,
      },
      diagnosticJobSchema,
    );
  }
  private async call<T, O extends DiagnosticOperation>(
    orgId: string,
    p: DiagnosticPrincipal,
    operation: O,
    args: Omit<DiagnosticArgs<O>, DiagnosticIdentityKeys>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    if (orgId !== p.organizationId) throw new DiagnosticDeniedError();
    let result: { data: unknown; error: { code?: string } | null };
    try {
      const client = this.supabase.admin();
      result = await client.rpc(`m15_04_${operation}`, {
        p_organization_id: orgId,
        p_actor_user_id: p.actorId,
        p_session_id: p.sessionId,
        ...args,
      });
    } catch {
      throw new DiagnosticUnavailableError();
    }
    if (result.error) {
      if (result.error.code === "42501") throw new DiagnosticDeniedError();
      if (result.error.code === "40001" || result.error.code === "23505")
        throw new DiagnosticConflictError();
      throw new DiagnosticUnavailableError();
    }
    const envelope = envelopeSchema.safeParse(result.data);
    if (!envelope.success) throw new DiagnosticUnavailableError();
    if (
      [
        "denied",
        "not_found",
        "forbidden",
        "expired",
        "access_changed",
        "invalid_grant",
      ].includes(envelope.data.outcome)
    )
      throw new DiagnosticDeniedError();
    if (
      ["conflict", "stale", "blocked", "idempotency_conflict", "busy"].includes(
        envelope.data.outcome,
      )
    )
      throw new DiagnosticConflictError();
    if (envelope.data.outcome === "invalid") throw new DiagnosticInvalidError();
    if (envelope.data.outcome !== "ok") throw new DiagnosticUnavailableError();
    const parsed = schema.safeParse(envelope.data.result);
    if (!parsed.success) throw new DiagnosticUnavailableError();
    return parsed.data;
  }
}
