import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { auditRangeJobSchema } from "@repo/contracts/audit/schemas";
import type {
  AuditRangeCreateInput,
  AuditRangeJob,
  AuditRangeOperationInput,
} from "@repo/contracts/audit/types";
import { z } from "zod";
import { SupabaseService } from "../../../supabase/supabase.service";
import type {
  AuditRangeWorkerJob,
  AuditRangeWorkerPort,
  AuditRangeCursor,
} from "../audit-range-worker.port";
import type { AuditRangeResult } from "@repo/contracts/audit/types";
import {
  auditRangeWorkerJobProviderSchema,
  auditRangeMutationProviderSchema,
  authorizationProviderSchema,
  revalidationProviderSchema,
  rangePageProviderSchema,
} from "./audit-range-provider.schemas";
import type { AuditRangeRepository } from "../application/audit-range.port";
import {
  AuditRangeLimitError,
  AuditRangeInputError,
  AuditRangeConflictError,
  AuditRangeNotFoundError,
  AuditRangeUnavailableError,
} from "../audit-range.errors";
const receiptSchema = z.object({ receiptId: z.uuid() }).strict();
@Injectable()
export class SupabaseAuditRangeRepository
  implements AuditRangeRepository, AuditRangeWorkerPort
{
  constructor(private readonly supabase: SupabaseService) {}
  async create(
    orgId: string,
    actorId: string,
    input: AuditRangeCreateInput,
  ): Promise<AuditRangeJob> {
    const criteria = {
      fromSequence: input.fromSequence,
      toSequence: input.toSequence ?? null,
      priorCheckpoint: input.priorCheckpoint ?? null,
    };
    return this.readJob("m13_04_create_verification", {
      p_organization_id: orgId,
      p_actor_user_id: actorId,
      p_request_id: input.requestId,
      p_from_sequence: input.fromSequence,
      p_to_sequence: criteria.toSequence,
      p_checkpoint: criteria.priorCheckpoint,
      p_request_digest: createHash("sha256")
        .update(JSON.stringify(criteria))
        .digest("hex"),
    });
  }
  status(
    orgId: string,
    actorId: string,
    jobId: string,
    requestId: string,
  ): Promise<AuditRangeJob> {
    return this.readJob("m13_04_read_verification", {
      p_organization_id: orgId,
      p_actor_user_id: actorId,
      p_job_id: jobId,
      p_request_id: requestId,
    });
  }
  cancel(
    orgId: string,
    actorId: string,
    jobId: string,
    input: AuditRangeOperationInput,
  ): Promise<AuditRangeJob> {
    return this.control(orgId, actorId, jobId, input, "cancel");
  }
  resume(
    orgId: string,
    actorId: string,
    jobId: string,
    input: AuditRangeOperationInput,
  ): Promise<AuditRangeJob> {
    return this.control(orgId, actorId, jobId, input, "resume");
  }
  async recordDenial(
    orgId: string,
    actorId: string,
    requestId: string,
    operationDigest: string,
  ): Promise<void> {
    const data = await this.rpc("m13_04_record_denial", {
      p_organization_id: orgId,
      p_actor_user_id: actorId,
      p_request_id: requestId,
      p_operation_digest: operationDigest,
    });
    try {
      receiptSchema.parse(data);
    } catch {
      throw new AuditRangeUnavailableError();
    }
  }
  async claim(workerId: string): Promise<AuditRangeWorkerJob | null> {
    const data = await this.rpc("m13_04_claim_verification", {
      p_worker_id: workerId,
    });
    return data === null
      ? null
      : this.parse(auditRangeWorkerJobProviderSchema, data);
  }
  async authorizeBatch(
    job: AuditRangeWorkerJob,
    limit: number,
    maximumBytes: number,
  ) {
    return this.parse(
      authorizationProviderSchema,
      await this.rpc("m13_04_authorize_verification", {
        ...this.lease(job),
        p_limit: limit,
        p_maximum_bytes: maximumBytes,
      }),
    );
  }
  async revalidate(job: AuditRangeWorkerJob) {
    return this.parse(
      revalidationProviderSchema,
      await this.rpc("m13_04_revalidate_verification", this.lease(job)),
    );
  }
  async page(
    job: AuditRangeWorkerJob,
    afterSequence: string,
    upperSequence: string,
    limit: number,
    maximumBytes: number,
  ) {
    return this.parse(
      rangePageProviderSchema,
      await this.rpc("m13_04_page_verification", {
        ...this.lease(job),
        p_after_sequence: afterSequence,
        p_upper_sequence: upperSequence,
        p_limit: limit,
        p_maximum_bytes: maximumBytes,
      }),
    );
  }
  async checkpoint(
    job: AuditRangeWorkerJob,
    cursor: AuditRangeCursor | null,
    result: AuditRangeResult | null,
  ): Promise<void> {
    this.parse(
      auditRangeMutationProviderSchema,
      await this.rpc("m13_04_checkpoint_verification", {
        ...this.lease(job),
        p_cursor: cursor,
        p_result: result,
      }),
    );
  }
  async finishUnavailable(
    job: AuditRangeWorkerJob,
    outcome: "scope_unavailable" | "checkpoint_unavailable",
  ): Promise<void> {
    this.parse(
      auditRangeMutationProviderSchema,
      await this.rpc("m13_04_finish_unavailable_verification", {
        ...this.lease(job),
        p_outcome: outcome,
      }),
    );
  }
  async fail(
    job: AuditRangeWorkerJob,
    code:
      | "provider_unavailable"
      | "malformed_provider"
      | "event_limit"
      | "byte_limit",
    retryable: boolean,
  ): Promise<void> {
    this.parse(
      auditRangeMutationProviderSchema,
      await this.rpc("m13_04_fail_verification", {
        ...this.lease(job),
        p_code: code,
        p_retryable: retryable,
      }),
    );
  }
  private lease(job: AuditRangeWorkerJob) {
    return {
      p_organization_id: job.organizationId,
      p_job_id: job.id,
      p_worker_id: job.workerId,
      p_lease_token: job.leaseToken,
      p_expected_version: job.version,
    };
  }
  private parse<T>(schema: z.ZodType<T>, value: unknown): T {
    try {
      return schema.parse(value);
    } catch {
      throw new AuditRangeUnavailableError();
    }
  }
  private control(
    orgId: string,
    actorId: string,
    jobId: string,
    input: AuditRangeOperationInput,
    operation: "cancel" | "resume",
  ) {
    return this.readJob("m13_04_control_verification", {
      p_organization_id: orgId,
      p_actor_user_id: actorId,
      p_job_id: jobId,
      p_request_id: input.requestId,
      p_expected_version: input.expectedVersion,
      p_operation: operation,
    });
  }
  private async readJob(
    name: string,
    args: Record<string, unknown>,
  ): Promise<AuditRangeJob> {
    const data = await this.rpc(name, args);
    try {
      return auditRangeJobSchema.parse(data);
    } catch {
      throw new AuditRangeUnavailableError();
    }
  }
  private async rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const { data, error } = await this.supabase
      .admin()
      .rpc(name as never, args as never)
      .then(
        (result) => result,
        () => {
          throw new AuditRangeUnavailableError();
        },
      );
    if (error) {
      if (
        error.code === "54000" &&
        (name === "m13_04_page_verification" ||
          name === "m13_04_authorize_verification")
      ) {
        if (error.message === "verification byte limit")
          throw new AuditRangeLimitError("byte_limit");
        if (error.message === "verification event limit")
          throw new AuditRangeLimitError("event_limit");
        throw new AuditRangeUnavailableError();
      }
      if (error.code === "22023") throw new AuditRangeInputError();
      if (
        error.code === "40001" ||
        error.code === "23505" ||
        error.code === "54000"
      )
        throw new AuditRangeConflictError();
      if (error.code === "P0002" || error.code === "42501")
        throw new AuditRangeNotFoundError();
      throw new AuditRangeUnavailableError();
    }
    return data;
  }
}
