import { Injectable } from "@nestjs/common";
import { z } from "zod";
import {
  siemDestinationSchema,
  siemDestinationListSchema,
  siemDeliverySchema,
  siemDeliveryDetailSchema,
  siemDeliveryPageSchema,
  siemReplayPreviewSchema,
  siemTestResultSchema,
} from "@repo/contracts/audit/schemas";
import { SupabaseService } from "../../../supabase/supabase.service";
import type {
  SiemOperation,
  SiemRepositoryPort,
} from "../application/siem-repository.port";
import type {
  SiemClaim,
  SiemCompletion,
  SiemWorkerPort,
} from "../worker/siem-worker.port";
import {
  SiemConflictError,
  SiemNotFoundError,
  SiemInputError,
  SiemUnavailableError,
} from "../siem.errors";
import {
  siemClaimSchema,
  siemFingerprintKeySchema,
  siemMutationSchema,
  siemTestContextSchema,
} from "../application/siem-provider.schemas";
const commandSchemas: Partial<Record<SiemOperation, z.ZodType>> = {
  list: siemDestinationListSchema,
  get: siemDestinationSchema,
  create: siemDestinationSchema,
  update: siemDestinationSchema,
  rotate_credentials: siemDestinationSchema,
  revoke_credentials: siemDestinationSchema,
  enable: siemDestinationSchema,
  disable: siemDestinationSchema,
  test: siemTestResultSchema,
  deliveries: siemDeliveryPageSchema,
  delivery: siemDeliveryDetailSchema,
  replay_preview: siemReplayPreviewSchema,
  replay: siemDeliverySchema,
  fingerprint_key: siemFingerprintKeySchema,
  test_prepare: z.union([
    siemTestContextSchema,
    z
      .object({ completed: z.literal(true), result: siemTestResultSchema })
      .strict(),
  ]),
};
@Injectable()
export class SupabaseSiemRepository
  implements SiemRepositoryPort, SiemWorkerPort
{
  constructor(private readonly supabase: SupabaseService) {}
  async command(
    orgId: string,
    actorId: string,
    operation: SiemOperation,
    destinationId: string | null,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const data = await this.rpc("m13_05_siem_command", {
      p_organization_id: orgId,
      p_actor_user_id: actorId,
      p_operation:
        operation === "get"
          ? "read"
          : operation === "rotate_credentials"
            ? "credentials"
            : operation,
      p_request_id: input.requestId,
      p_expected_version: input.expectedVersion ?? null,
      p_destination_id: destinationId,
      p_input: input,
    });
    return this.parse(commandSchemas[operation] ?? siemMutationSchema, data);
  }
  async stage(workerId: string): Promise<void> {
    this.parse(
      z.object({ staged: z.number().int().nonnegative() }).strict(),
      await this.rpc("m13_05_siem_stage", { p_worker_id: workerId }),
    );
  }
  async claim(workerId: string): Promise<SiemClaim | null> {
    const data = await this.rpc("m13_05_siem_claim", { p_worker_id: workerId });
    return data === null ? null : this.parse(siemClaimSchema, data);
  }
  async authorize(claim: SiemClaim): Promise<SiemClaim | null> {
    const data = await this.rpc(
      "m13_05_siem_authorize_delivery",
      this.lease(claim),
    );
    return data === null ? null : this.parse(siemClaimSchema, data);
  }
  async complete(claim: SiemClaim, outcome: SiemCompletion): Promise<void> {
    this.parse(
      siemMutationSchema,
      await this.rpc("m13_05_siem_complete", {
        ...this.lease(claim),
        p_outcome: outcome,
      }),
    );
  }
  private lease(claim: SiemClaim) {
    return {
      p_organization_id: claim.organizationId,
      p_delivery_id: claim.deliveryId,
      p_lease_token: claim.leaseToken,
      p_version: claim.version,
      p_worker_id: claim.workerId,
    };
  }
  private parse<T>(schema: z.ZodType<T>, data: unknown): T {
    try {
      return schema.parse(data);
    } catch {
      throw new SiemUnavailableError();
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
        (r) => r,
        () => {
          throw new SiemUnavailableError();
        },
      );
    if (error) {
      if (
        error.code === "23505" ||
        error.code === "40001" ||
        error.code === "54000"
      )
        throw new SiemConflictError();
      if (error.code === "42501" || error.code === "P0002")
        throw new SiemNotFoundError();
      if (error.code === "22023") throw new SiemInputError();
      throw new SiemUnavailableError();
    }
    return data;
  }
}
