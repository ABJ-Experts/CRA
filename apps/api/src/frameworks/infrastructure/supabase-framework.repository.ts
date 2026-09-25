import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  frameworkCatalogResponseSchema,
  frameworkTreeResponseSchema,
  frameworkSelectionResponseSchema,
} from "@repo/contracts/frameworks";
import { z } from "zod";

import { SupabaseService } from "../../supabase/supabase.service";
import {
  FrameworkConflictError,
  FrameworkForbiddenError,
  FrameworkInvalidRequestError,
  FrameworkUpgradeRequiredError,
  FrameworkPackBlockedError,
  type FrameworkRepository,
} from "../application/framework-use-cases";

const unavailable = () =>
  new ServiceUnavailableException({
    message: "Frameworks are temporarily unavailable.",
    code: "framework_unavailable",
  });

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (!/^(0|[1-9]\d{0,3})$/.test(decoded))
    throw new FrameworkInvalidRequestError();
  const offset = Number(decoded);
  if (offset > 1_000) throw new FrameworkInvalidRequestError();
  if (Buffer.from(String(offset)).toString("base64url") !== cursor) {
    throw new FrameworkInvalidRequestError();
  }
  return offset;
}

@Injectable()
export class SupabaseFrameworkRepository implements FrameworkRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async catalog(orgId: string, actorId: string) {
    const client = this.supabase.admin();
    await this.verifyMembership(orgId, actorId);
    const [
      { data: packs, error: packError },
      { data: selections, error: selectionError },
    ] = await Promise.all([
      client
        .from("framework_pack_versions")
        .select(
          "pack_key,version_key,title,edition_date,language,source_celex,source_url,attribution,content_hash,source_kind,edition_label,distribution_rights,review_owner",
        )
        .order("pack_key")
        .order("edition_date", { ascending: false })
        .limit(101),
      client
        .from("organization_framework_selections")
        .select("pack_key,version_key,enabled,revision")
        .eq("organization_id", orgId)
        .limit(101),
    ]);
    if (packError || selectionError || !packs || !selections)
      throw unavailable();
    if (packs.length > 100 || selections.length > 100) throw unavailable();

    const selected = new Map(selections.map((row) => [row.pack_key, row]));
    type CatalogPack = z.output<
      typeof frameworkCatalogResponseSchema
    >["packs"][number];
    const grouped = new Map<string, CatalogPack>();
    for (const row of packs) {
      const sourceKind = row.source_kind
        ? z
            .enum(["public_law", "licensed_standard", "approved_fixture"])
            .safeParse(row.source_kind)
        : null;
      if (sourceKind && !sourceKind.success) throw unavailable();
      const existing = grouped.get(row.pack_key);
      const selection = selected.get(row.pack_key);
      const pack: CatalogPack = existing ?? {
        packKey: row.pack_key,
        title: row.title,
        versions: [],
        selection: selection
          ? {
              versionKey: selection.version_key,
              enabled: selection.enabled,
              revision: selection.revision,
            }
          : null,
      };
      pack.versions.push({
        versionKey: row.version_key,
        editionDate: row.edition_date,
        language: row.language,
        sourceUrl: row.source_url,
        sourceReference: row.source_celex
          ? `CELEX:${row.source_celex}`
          : (row.edition_label ?? row.source_url),
        attribution: row.attribution,
        contentHash: row.content_hash,
        ...(sourceKind
          ? {
              sourceKind: sourceKind.data,
              editionLabel: row.edition_label,
              distributionRights: row.distribution_rights,
              reviewOwner: row.review_owner,
            }
          : {}),
      });
      grouped.set(row.pack_key, pack);
    }
    return frameworkCatalogResponseSchema.parse({
      packs: [...grouped.values()],
    });
  }

  async tree(orgId: string, input: Parameters<FrameworkRepository["tree"]>[1]) {
    const client = this.supabase.admin();
    await this.verifyMembership(orgId, input.actorId);
    // Pack content is global and immutable. This scoped membership check must
    // precede the global read because the service-role client bypasses RLS.
    const { data: pack, error: packError } = await client
      .from("framework_pack_versions")
      .select("pack_key,edition_date,language")
      .eq("pack_key", input.packKey)
      .eq("version_key", input.versionKey)
      .maybeSingle();
    if (packError) throw unavailable();
    if (!pack) return null;

    const offset = decodeCursor(input.cursor);
    const { data: rows, error } = await client
      .from("framework_requirements")
      .select(
        "requirement_key,identifier,parent_requirement_key,position,depth,heading,text,source_reference",
      )
      .eq("pack_key", input.packKey)
      .eq("version_key", input.versionKey)
      .order("tree_order")
      .range(offset, offset + input.limit);
    if (error || !rows) throw unavailable();
    const page = rows.slice(0, input.limit);
    const nextCursor =
      rows.length > input.limit
        ? Buffer.from(String(offset + input.limit)).toString("base64url")
        : null;
    return frameworkTreeResponseSchema.parse({
      packKey: input.packKey,
      versionKey: input.versionKey,
      editionDate: pack.edition_date,
      language: pack.language,
      requirements: page.map((row) => ({
        requirementKey: row.requirement_key,
        identifier: row.identifier,
        parentKey: row.parent_requirement_key,
        position: row.position,
        depth: row.depth,
        heading: row.heading,
        text: row.text,
        sourceReference: row.source_reference,
      })),
      nextCursor,
    });
  }

  async select(
    orgId: string,
    input: Parameters<FrameworkRepository["select"]>[1],
  ) {
    const { data, error } = await this.supabase
      .admin()
      .rpc("m10_select_framework_version", {
        p_organization_id: orgId,
        p_actor_user_id: input.actorId,
        p_pack_key: input.packKey,
        p_version_key: input.versionKey,
        p_enabled: input.enabled,
        // The SQL function accepts NULL for first selection; Supabase typegen
        // marks all positional RPC arguments non-null even when SQL permits it.
        p_expected_revision: input.expectedRevision as number,
        p_idempotency_key: input.idempotencyKey,
      });
    if (error || !data) throw unavailable();
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== "object" || !("outcome" in row))
      throw unavailable();
    if (row.outcome === "conflict") throw new FrameworkConflictError();
    if (row.outcome === "upgrade_required")
      throw new FrameworkUpgradeRequiredError();
    if (row.outcome === "blocked") throw new FrameworkPackBlockedError();
    if (row.outcome === "forbidden") throw new FrameworkForbiddenError();
    if (row.outcome === "invalid_request")
      throw new FrameworkInvalidRequestError();
    if (row.outcome !== "selected" && row.outcome !== "unchanged")
      throw unavailable();
    return frameworkSelectionResponseSchema.parse(row.result);
  }

  private async verifyMembership(
    orgId: string,
    actorId: string,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .admin()
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("user_id", actorId)
      .maybeSingle();
    if (error) throw unavailable();
    if (!data) throw new FrameworkForbiddenError();
  }
}
