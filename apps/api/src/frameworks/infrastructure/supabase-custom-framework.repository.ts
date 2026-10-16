import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  customFrameworkCommandResponseSchema,
  customFrameworkContentSchema,
  customFrameworkDetailResponseSchema,
  customFrameworkListResponseSchema,
  customFrameworkValidationResponseSchema,
} from "@repo/contracts/frameworks";
import { z } from "zod";

import { SupabaseService } from "../../supabase/supabase.service";
import {
  CustomFrameworkBlockedError,
  CustomFrameworkConflictError,
  CustomFrameworkForbiddenError,
  CustomFrameworkInvalidError,
  CustomFrameworkNotFoundError,
  type CustomFrameworkRepository,
} from "../application/custom-framework-use-cases";

const rpcResultSchema = z.object({ outcome: z.string(), result: z.unknown() });
const unavailable = () =>
  new ServiceUnavailableException({
    message: "Customer frameworks are temporarily unavailable.",
    code: "framework_unavailable",
  });

function parseProviderOutput<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown,
): z.output<TSchema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw unavailable();
  return parsed.data;
}

function unpack(data: unknown): { outcome: string; result: unknown } {
  const parsed = rpcResultSchema.safeParse(
    Array.isArray(data) ? data[0] : data,
  );
  if (!parsed.success) throw unavailable();
  switch (parsed.data.outcome) {
    case "forbidden":
      throw new CustomFrameworkForbiddenError();
    case "not_found":
      throw new CustomFrameworkNotFoundError();
    case "invalid_request":
      throw new CustomFrameworkInvalidError();
    case "conflict":
      throw new CustomFrameworkConflictError();
    case "blocked":
      throw new CustomFrameworkBlockedError();
    default:
      return parsed.data;
  }
}

@Injectable()
export class SupabaseCustomFrameworkRepository implements CustomFrameworkRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async list(orgId: string, actorId: string, limit: number, offset: number) {
    const { data, error } = await this.supabase
      .admin()
      .rpc("m10_custom_pack_page", {
        p_organization_id: orgId,
        p_actor_user_id: actorId,
        p_limit: limit,
        p_offset: offset,
      });
    if (error) throw unavailable();
    const row = unpack(data);
    if (row.outcome !== "listed") throw unavailable();
    return parseProviderOutput(customFrameworkListResponseSchema, row.result);
  }

  async detail(orgId: string, actorId: string, draftId: string) {
    const { data, error } = await this.supabase
      .admin()
      .rpc("m10_custom_pack_detail", {
        p_organization_id: orgId,
        p_actor_user_id: actorId,
        p_draft_id: draftId,
      });
    if (error) throw unavailable();
    const row = unpack(data);
    if (row.outcome !== "found") throw unavailable();
    return parseProviderOutput(customFrameworkDetailResponseSchema, row.result);
  }

  async exportVersion(
    orgId: string,
    actorId: string,
    draftId: string,
    versionKey: string,
  ) {
    const draft = await this.detail(orgId, actorId, draftId);
    const client = this.supabase.admin();
    const { data: version, error: versionError } = await client
      .from("framework_pack_versions")
      .select("title,edition_date,language,attribution,source_url")
      .eq("owner_org_id", orgId)
      .eq("pack_key", draft.packKey)
      .eq("version_key", versionKey)
      .maybeSingle();
    if (versionError) throw unavailable();
    if (!version) throw new CustomFrameworkNotFoundError();
    const { data: rows, error: requirementsError } = await client
      .from("framework_requirements")
      .select(
        "requirement_key,identifier,parent_requirement_key,position,heading,text,source_reference",
      )
      .eq("owner_org_id", orgId)
      .eq("pack_key", draft.packKey)
      .eq("version_key", versionKey)
      .order("tree_order")
      .limit(1001);
    if (requirementsError || !rows || rows.length > 1000) throw unavailable();
    return parseProviderOutput(customFrameworkContentSchema, {
      title: version.title,
      editionDate: version.edition_date,
      language: version.language,
      attribution: version.attribution,
      ...(version.source_url ? { sourceUrl: version.source_url } : {}),
      requirements: rows.map((item) => ({
        requirementKey: item.requirement_key,
        identifier: item.identifier,
        parentKey: item.parent_requirement_key,
        position: item.position,
        heading: item.heading,
        text: item.text,
        sourceReference: item.source_reference,
      })),
    });
  }

  async command(
    orgId: string,
    actorId: string,
    draftId: string | null,
    input: Parameters<CustomFrameworkRepository["command"]>[3],
  ) {
    const payload =
      "content" in input
        ? { ...(draftId ? { draftId } : {}), document: input.content }
        : { draftId };
    const { data, error } = await this.supabase
      .admin()
      .rpc("m10_custom_pack_command", {
        p_organization_id: orgId,
        p_actor_user_id: actorId,
        p_operation: input.action,
        p_payload: payload,
        // SQL permits NULL for a first draft; generated positional RPC types do not.
        p_expected_revision: ("expectedRevision" in input
          ? input.expectedRevision
          : null) as number,
        p_idempotency_key: input.idempotencyKey,
      });
    if (error) throw unavailable();
    const row = unpack(data);
    if (
      ![
        "created",
        "saved",
        "published",
        "archived",
        "restored",
        "unchanged",
      ].includes(row.outcome)
    ) {
      throw unavailable();
    }
    return parseProviderOutput(
      customFrameworkCommandResponseSchema,
      row.result,
    );
  }

  async validate(
    orgId: string,
    actorId: string,
    content: Parameters<CustomFrameworkRepository["validate"]>[2],
  ) {
    const { data, error } = await this.supabase
      .admin()
      .rpc("m10_custom_pack_validate", {
        p_organization_id: orgId,
        p_actor_user_id: actorId,
        p_document: content,
      });
    if (error) throw unavailable();
    const parsed = rpcResultSchema.safeParse(
      Array.isArray(data) ? data[0] : data,
    );
    if (!parsed.success) throw unavailable();
    const row = parsed.data;
    if (row.outcome === "forbidden") throw new CustomFrameworkForbiddenError();
    if (row.outcome === "invalid_request") {
      return parseProviderOutput(
        customFrameworkValidationResponseSchema,
        row.result,
      );
    }
    if (row.outcome !== "validated") throw unavailable();
    return {
      valid: parseProviderOutput(
        z.object({ valid: z.literal(true) }),
        row.result,
      ).valid,
      errors: [],
    };
  }
}
