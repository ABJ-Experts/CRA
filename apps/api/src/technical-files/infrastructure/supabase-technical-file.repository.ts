import { Injectable } from "@nestjs/common";
import {
  technicalFileResponseSchema,
  technicalFileSectionResponseSchema,
  type AddTechnicalFileSourceRequest,
  type CreateTechnicalFileRequest,
  type TechnicalFile,
  type TechnicalFileSection,
  type UpdateTechnicalFileSectionRequest,
} from "@repo/contracts/technical-files";

import { SupabaseService } from "../../supabase/supabase.service";
import {
  TechnicalFileConflictError,
  TechnicalFileInvalidRequestError,
  type TechnicalFileRepository,
} from "../application/technical-file.port";

type RpcClient = Readonly<{
  rpc(
    name: string,
    args?: Readonly<Record<string, unknown>>,
  ): Promise<
    Readonly<{
      data: unknown;
      error: Readonly<{ code?: string; message: string }> | null;
    }>
  >;
}>;

/** Service-role adapter; every RPC receives the verified org and public user IDs. */
@Injectable()
export class SupabaseTechnicalFileRepository implements TechnicalFileRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async get(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string }>,
  ) {
    const rpc = await this.call(
      "get_technical_file",
      scope(organizationId, input),
    );
    return this.technicalFile(rpc);
  }

  async create(
    organizationId: string,
    input: Readonly<
      { actorId: string; productId: string } & CreateTechnicalFileRequest
    >,
  ) {
    const rpc = await this.call("create_technical_file_atomic", {
      ...scope(organizationId, input),
      p_idempotency_key: input.idempotencyKey,
    });
    return this.technicalFile(rpc);
  }

  async getSection(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string; sectionKey: string }>,
  ) {
    const rpc = await this.call("get_technical_file_section", {
      ...scope(organizationId, input),
      p_section_key: input.sectionKey,
    });
    return this.section(rpc);
  }

  async updateSection(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        sectionKey: string;
      } & UpdateTechnicalFileSectionRequest
    >,
  ) {
    const rpc = await this.call("update_technical_file_section_atomic", {
      ...scope(organizationId, input),
      p_section_key: input.sectionKey,
      p_expected_version: input.expectedVersion,
      p_narrative: input.narrative,
      p_applicability: input.applicability,
      p_non_applicability_reason: input.nonApplicabilityReason,
      p_idempotency_key: input.idempotencyKey,
    });
    return this.section(rpc);
  }

  async addSource(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        sectionKey: string;
      } & AddTechnicalFileSourceRequest
    >,
  ) {
    const rpc = await this.call("add_technical_file_section_source_atomic", {
      ...scope(organizationId, input),
      p_section_key: input.sectionKey,
      p_expected_version: input.expectedVersion,
      p_source_kind: input.sourceKind,
      p_record_id: input.recordId ?? null,
      p_title: input.manualReference?.title ?? null,
      p_edition_or_revision: input.manualReference?.editionOrRevision ?? null,
      p_issuer: input.manualReference?.issuer ?? null,
      p_locator: input.manualReference?.locator ?? null,
      p_rationale: input.manualReference?.rationale ?? null,
      p_idempotency_key: input.idempotencyKey,
    });
    return this.section(rpc);
  }

  async removeSource(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      sectionKey: string;
      sourceId: string;
      expectedVersion: number;
      idempotencyKey: string;
    }>,
  ) {
    const rpc = await this.call("remove_technical_file_section_source_atomic", {
      ...scope(organizationId, input),
      p_section_key: input.sectionKey,
      p_source_id: input.sourceId,
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey,
    });
    return this.section(rpc);
  }

  private async call(name: string, args: Readonly<Record<string, unknown>>) {
    const response = await this.client().rpc(name, args);
    if (response.error) {
      throw new Error(
        `technical file RPC ${name} failed${response.error.code ? ` (${response.error.code})` : ""}: ${response.error.message}`,
      );
    }
    const row = one(response.data);
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("invalid technical file RPC result");
    }
    const record = row as Record<string, unknown>;
    if (typeof record.outcome !== "string")
      throw new Error("invalid technical file RPC outcome");
    return { outcome: record.outcome, result: record.result };
  }

  private technicalFile(
    rpc: Readonly<{ outcome: string; result: unknown }>,
  ): TechnicalFile | null {
    this.throwFailure(rpc);
    if (rpc.outcome === "not_found") return null;
    if (!["found", "created"].includes(rpc.outcome))
      throw new Error("technical file unavailable");
    return technicalFileResponseSchema.parse(rpc.result).technicalFile;
  }

  private section(
    rpc: Readonly<{ outcome: string; result: unknown }>,
  ): TechnicalFileSection | null {
    this.throwFailure(rpc);
    if (rpc.outcome === "not_found") return null;
    if (!["found", "updated", "created", "deleted"].includes(rpc.outcome))
      throw new Error("technical file unavailable");
    return technicalFileSectionResponseSchema.parse(rpc.result).section;
  }

  private throwFailure(rpc: Readonly<{ outcome: string; result: unknown }>) {
    if (
      ["conflict", "version_conflict", "idempotency_conflict"].includes(
        rpc.outcome,
      )
    ) {
      const section = parseSection(rpc.result);
      throw new TechnicalFileConflictError(section);
    }
    if (rpc.outcome === "invalid_request" || rpc.outcome === "forbidden") {
      throw new TechnicalFileInvalidRequestError();
    }
  }

  private client(): RpcClient {
    return this.supabase.admin() as unknown as RpcClient;
  }
}

function scope(
  organizationId: string,
  input: Readonly<{ actorId: string; productId: string }>,
) {
  return {
    p_organization_id: organizationId,
    p_actor_user_id: input.actorId,
    p_product_id: input.productId,
  };
}

function one(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function parseSection(value: unknown): TechnicalFileSection | null {
  const parsed = technicalFileSectionResponseSchema.safeParse(value);
  return parsed.success ? parsed.data.section : null;
}
