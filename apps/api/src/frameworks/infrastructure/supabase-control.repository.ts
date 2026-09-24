import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  controlCommandResponseSchema,
  controlDetailResponseSchema,
  controlListResponseSchema,
  controlOwnerCandidatesResponseSchema,
  requirementCoverageResponseSchema,
} from "@repo/contracts/frameworks";
import type { z } from "zod";

import { SupabaseService } from "../../supabase/supabase.service";
import type { Json } from "../../supabase/database.types";
import {
  ControlBlockedError,
  ControlConflictError,
  ControlForbiddenError,
  ControlInvalidRequestError,
  ControlNotFoundError,
  type ControlRepository,
} from "../application/control-use-cases";

const unavailable = () =>
  new ServiceUnavailableException({
    message: "Controls are temporarily unavailable.",
    code: "controls_unavailable",
  });

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (
    !/^(0|[1-9]\d{0,8})$/.test(decoded) ||
    Buffer.from(decoded).toString("base64url") !== cursor
  )
    throw new ControlInvalidRequestError();
  return Number(decoded);
}

function nextCursor(
  offset: number,
  pageSize: number,
  rowCount: number,
): string | null {
  return rowCount > pageSize
    ? Buffer.from(String(offset + pageSize)).toString("base64url")
    : null;
}

function memberDisplayName(user: {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
}): string {
  const candidate =
    [user.first_name, user.last_name].filter(Boolean).join(" ").trim() ||
    user.username?.trim() ||
    `Member ${user.id.slice(0, 8)}`;
  if (
    candidate.length > 200 ||
    /[\p{Cc}\p{Cf}]/u.test(candidate) ||
    /<[^>]+>/u.test(candidate)
  )
    return `Member ${user.id.slice(0, 8)}`;
  return candidate;
}

function decodeControlCursor(
  cursor: string | undefined,
): readonly [string, string] | null {
  if (!cursor) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new ControlInvalidRequestError();
  }
  if (
    !Array.isArray(decoded) ||
    decoded.length !== 2 ||
    typeof decoded[0] !== "string" ||
    typeof decoded[1] !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+\d\d:\d\d)$/.test(
      decoded[0],
    ) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      decoded[1],
    ) ||
    Buffer.from(JSON.stringify(decoded)).toString("base64url") !== cursor
  )
    throw new ControlInvalidRequestError();
  return [decoded[0], decoded[1]];
}

@Injectable()
export class SupabaseControlRepository implements ControlRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async list(orgId: string, input: Parameters<ControlRepository["list"]>[1]) {
    await this.verifyMembership(orgId, input.actorId);
    const after = decodeControlCursor(input.cursor);
    let query = this.supabase
      .admin()
      .from("framework_controls")
      .select(
        "id,title,description,owner_user_id,implementation_status,revision,archived_at,created_at,updated_at",
      )
      .eq("organization_id", orgId)
      .order("updated_at", { ascending: false })
      .order("id")
      .limit(input.limit + 1);
    if (!input.includeArchived) query = query.is("archived_at", null);
    if (after)
      query = query.or(
        `updated_at.lt.${after[0]},and(updated_at.eq.${after[0]},id.gt.${after[1]})`,
      );
    const { data: rows, error } = await query;
    if (error || !rows) throw unavailable();
    const owners = await this.activeOwnerIds(
      orgId,
      rows.map((row) => row.owner_user_id),
    );
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    return controlListResponseSchema.parse({
      controls: page.map((row) => this.summary(row, owners)),
      nextCursor:
        rows.length > input.limit && last
          ? Buffer.from(JSON.stringify([last.updated_at, last.id])).toString(
              "base64url",
            )
          : null,
    });
  }

  async ownerCandidates(
    orgId: string,
    input: Parameters<ControlRepository["ownerCandidates"]>[1],
  ) {
    await this.verifyMembership(orgId, input.actorId);
    const offset = decodeCursor(input.cursor);
    const { data: members, error } = await this.supabase
      .admin()
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", orgId)
      .order("user_id")
      .range(offset, offset + input.limit);
    if (error || !members) throw unavailable();
    const ids = members.slice(0, input.limit).map((row) => row.user_id);
    const { data: users, error: usersError } = ids.length
      ? await this.supabase
          .admin()
          .from("users")
          .select("id,first_name,last_name,username,is_active")
          .in("id", ids)
          .eq("is_active", true)
      : { data: [], error: null };
    if (usersError || !users) throw unavailable();
    const names = new Map(
      users.map((user) => [user.id, memberDisplayName(user)]),
    );
    return controlOwnerCandidatesResponseSchema.parse({
      owners: ids
        .filter((id) => names.has(id))
        .map((id) => ({ id, displayName: names.get(id) })),
      nextCursor: nextCursor(offset, input.limit, members.length),
    });
  }

  async detail(
    orgId: string,
    input: Parameters<ControlRepository["detail"]>[1],
  ) {
    await this.verifyMembership(orgId, input.actorId);
    const client = this.supabase.admin();
    const { data: control, error: controlError } = await client
      .from("framework_controls")
      .select(
        "id,title,description,owner_user_id,implementation_status,revision,archived_at,created_at,updated_at",
      )
      .eq("organization_id", orgId)
      .eq("id", input.controlId)
      .maybeSingle();
    if (controlError) throw unavailable();
    if (!control) return null;
    const [linksResult, mappingsResult] = await Promise.all([
      input.canViewEvidence && input.canViewProducts
        ? client
            .from("framework_control_evidence_links")
            .select(
              "id,evidence_version_id,product_id,source_control_revision,ended_at,created_at",
            )
            .eq("organization_id", orgId)
            .eq("control_id", input.controlId)
            .order("created_at", { ascending: false })
            .limit(101)
        : Promise.resolve({ data: [], error: null }),
      client
        .from("framework_control_requirement_mappings")
        .select(
          "id,pack_key,version_key,requirement_key,rationale,source_control_revision,ended_at,created_at",
        )
        .eq("organization_id", orgId)
        .eq("control_id", input.controlId)
        .order("created_at", { ascending: false })
        .limit(101),
    ]);
    if (
      linksResult.error ||
      mappingsResult.error ||
      !linksResult.data ||
      !mappingsResult.data ||
      linksResult.data.length > 100 ||
      mappingsResult.data.length > 100
    )
      throw unavailable();
    const links = linksResult.data;
    const mappings = mappingsResult.data;
    const versionIds = [
      ...new Set(links.map((row) => row.evidence_version_id)),
    ];
    const { data: versions, error: versionsError } = versionIds.length
      ? await client
          .from("evidence_document_versions")
          .select(
            "id,document_id,title,version_number,processing_state,validity_starts_on,validity_ends_on",
          )
          .eq("organization_id", orgId)
          .in("id", versionIds)
      : { data: [], error: null };
    if (versionsError || !versions) throw unavailable();
    const documentIds = [...new Set(versions.map((row) => row.document_id))];
    const { data: documents, error: documentsError } = documentIds.length
      ? await client
          .from("evidence_documents")
          .select("id,lifecycle_state")
          .eq("organization_id", orgId)
          .in("id", documentIds)
      : { data: [], error: null };
    if (documentsError || !documents) throw unavailable();
    const documentState = new Map(
      documents.map((row) => [row.id, row.lifecycle_state]),
    );
    const pendingDeletionDocuments = await this.deletionDocumentIds(
      orgId,
      documentIds,
    );
    const versionById = new Map(versions.map((row) => [row.id, row]));
    const linkedProductIds = [...new Set(links.map((row) => row.product_id))];
    const { data: linkedProducts, error: linkedProductError } =
      linkedProductIds.length
        ? await client
            .from("products")
            .select("id,archived_at")
            .eq("organization_id", orgId)
            .in("id", linkedProductIds)
        : { data: [], error: null };
    if (linkedProductError || !linkedProducts) throw unavailable();
    const activeLinkedProducts = new Set(
      linkedProducts.filter((row) => !row.archived_at).map((row) => row.id),
    );
    const requirements = await this.requirementDetails(
      mappings.map((row) => ({
        packKey: row.pack_key,
        versionKey: row.version_key,
        requirementKey: row.requirement_key,
      })),
    );
    const mappingIds = mappings.map((row) => row.id);
    const { data: products, error: productError } =
      input.canViewProducts && mappingIds.length
        ? await client
            .from("framework_control_mapping_products")
            .select("mapping_id,product_id")
            .eq("organization_id", orgId)
            .in("mapping_id", mappingIds)
            .limit(10_001)
        : { data: [], error: null };
    if (productError || !products || products.length > 10_000)
      throw unavailable();
    const productByMapping = new Map<string, string[]>();
    for (const product of products)
      productByMapping.set(product.mapping_id, [
        ...(productByMapping.get(product.mapping_id) ?? []),
        product.product_id,
      ]);
    const owners = await this.activeOwnerIds(orgId, [control.owner_user_id]);
    return controlDetailResponseSchema.parse({
      ...this.summary(control, owners),
      evidenceRestricted: !input.canViewEvidence || !input.canViewProducts,
      evidenceLinks: links.map((link) => {
        const version = versionById.get(link.evidence_version_id);
        if (!version) throw unavailable();
        const today = new Date().toISOString().slice(0, 10);
        const availability =
          !activeLinkedProducts.has(link.product_id) ||
          pendingDeletionDocuments.has(version.document_id) ||
          documentState.get(version.document_id) !== "active"
            ? "unavailable"
            : version.processing_state === "quarantined"
              ? "quarantined"
              : version.processing_state !== "clean"
                ? "unavailable"
                : version.validity_starts_on &&
                    version.validity_starts_on > today
                  ? "unavailable"
                  : version.validity_ends_on && version.validity_ends_on < today
                    ? "expired"
                    : "available";
        return {
          id: link.id,
          evidenceVersionId: link.evidence_version_id,
          productId: link.product_id,
          evidenceTitle: version.title,
          evidenceVersionNumber: version.version_number,
          availability,
          sourceControlRevision: link.source_control_revision,
          endedAt: link.ended_at,
          createdAt: link.created_at,
        };
      }),
      mappings: mappings.map((mapping) => {
        const requirement = requirements.get(
          `${mapping.pack_key}:${mapping.version_key}:${mapping.requirement_key}`,
        );
        if (!requirement) throw unavailable();
        return {
          id: mapping.id,
          packKey: mapping.pack_key,
          versionKey: mapping.version_key,
          requirementKey: mapping.requirement_key,
          identifier: requirement.identifier,
          heading: requirement.heading,
          requirementText: requirement.text,
          rationale: mapping.rationale,
          productIds: productByMapping.get(mapping.id) ?? [],
          productsRestricted: !input.canViewProducts,
          sourceControlRevision: mapping.source_control_revision,
          endedAt: mapping.ended_at,
          createdAt: mapping.created_at,
        };
      }),
    });
  }

  async coverage(
    orgId: string,
    input: Parameters<ControlRepository["coverage"]>[1],
  ) {
    await this.verifyMembership(orgId, input.actorId);
    const client = this.supabase.admin();
    const { data: product, error: productError } = await client
      .from("products")
      .select("id")
      .eq("organization_id", orgId)
      .eq("id", input.productId)
      .is("archived_at", null)
      .maybeSingle();
    if (productError) throw unavailable();
    if (!product) throw new ControlForbiddenError();
    const { data: pack, error: packError } = await client
      .from("framework_pack_versions")
      .select("pack_key")
      .eq("pack_key", input.packKey)
      .eq("version_key", input.versionKey)
      .maybeSingle();
    if (packError) throw unavailable();
    if (!pack) return null;
    const offset = decodeCursor(input.cursor);
    const { data: requirements, error: requirementError } = await client
      .from("framework_requirements")
      .select("requirement_key,identifier,heading,text,parent_requirement_key")
      .eq("pack_key", input.packKey)
      .eq("version_key", input.versionKey)
      .order("tree_order")
      .range(offset, offset + input.limit);
    if (requirementError || !requirements) throw unavailable();
    const page = requirements.slice(0, input.limit);
    const keys = page.map((row) => row.requirement_key);
    const { data: mappings, error: mappingError } = keys.length
      ? await client
          .from("framework_control_requirement_mappings")
          .select("id,control_id,requirement_key")
          .eq("organization_id", orgId)
          .eq("pack_key", input.packKey)
          .eq("version_key", input.versionKey)
          .is("ended_at", null)
          .in("requirement_key", keys)
          .limit(10_001)
      : { data: [], error: null };
    if (mappingError || !mappings || mappings.length > 10_000)
      throw unavailable();
    const mappingIds = mappings.map((row) => row.id);
    const { data: applicable, error: applicableError } = mappingIds.length
      ? await client
          .from("framework_control_mapping_products")
          .select("mapping_id")
          .eq("organization_id", orgId)
          .eq("product_id", input.productId)
          .in("mapping_id", mappingIds)
          .limit(10_001)
      : { data: [], error: null };
    if (applicableError || !applicable || applicable.length > 10_000)
      throw unavailable();
    const applicableIds = new Set(applicable.map((row) => row.mapping_id));
    const activeMappings = mappings.filter((row) => applicableIds.has(row.id));
    const controlIds = [
      ...new Set(activeMappings.map((row) => row.control_id)),
    ];
    const { data: controls, error: controlsError } = controlIds.length
      ? await client
          .from("framework_controls")
          .select("id,title,owner_user_id,implementation_status")
          .eq("organization_id", orgId)
          .is("archived_at", null)
          .in("id", controlIds)
      : { data: [], error: null };
    if (controlsError || !controls) throw unavailable();
    const { data: evidenceLinks, error: linkError } = controlIds.length
      ? await client
          .from("framework_control_evidence_links")
          .select("control_id,evidence_version_id")
          .eq("organization_id", orgId)
          .eq("product_id", input.productId)
          .is("ended_at", null)
          .in("control_id", controlIds)
          .limit(10_001)
      : { data: [], error: null };
    if (linkError || !evidenceLinks || evidenceLinks.length > 10_000)
      throw unavailable();
    const versionIds = [
      ...new Set(evidenceLinks.map((row) => row.evidence_version_id)),
    ];
    const { data: evidenceVersions, error: evidenceError } = versionIds.length
      ? await client
          .from("evidence_document_versions")
          .select(
            "id,document_id,processing_state,validity_starts_on,validity_ends_on",
          )
          .eq("organization_id", orgId)
          .in("id", versionIds)
      : { data: [], error: null };
    if (evidenceError || !evidenceVersions) throw unavailable();
    const evidenceDocumentIds = [
      ...new Set(evidenceVersions.map((row) => row.document_id)),
    ];
    const { data: evidenceDocuments, error: evidenceDocumentError } =
      evidenceDocumentIds.length
        ? await client
            .from("evidence_documents")
            .select("id,lifecycle_state")
            .eq("organization_id", orgId)
            .in("id", evidenceDocumentIds)
        : { data: [], error: null };
    if (evidenceDocumentError || !evidenceDocuments) throw unavailable();
    const evidenceDocumentState = new Map(
      evidenceDocuments.map((row) => [row.id, row.lifecycle_state]),
    );
    const pendingDeletionDocuments = await this.deletionDocumentIds(
      orgId,
      evidenceDocumentIds,
    );
    const today = new Date().toISOString().slice(0, 10);
    const availableVersions = new Set(
      evidenceVersions
        .filter(
          (row) =>
            row.processing_state === "clean" &&
            !pendingDeletionDocuments.has(row.document_id) &&
            evidenceDocumentState.get(row.document_id) === "active" &&
            (!row.validity_starts_on || row.validity_starts_on <= today) &&
            (!row.validity_ends_on || row.validity_ends_on >= today),
        )
        .map((row) => row.id),
    );
    const evidenceControlIds = new Set(
      evidenceLinks
        .filter((row) => availableVersions.has(row.evidence_version_id))
        .map((row) => row.control_id),
    );
    const owners = await this.activeOwnerIds(
      orgId,
      controls.map((row) => row.owner_user_id),
    );
    const controlById = new Map(controls.map((row) => [row.id, row]));
    return requirementCoverageResponseSchema.parse({
      packKey: input.packKey,
      versionKey: input.versionKey,
      productId: input.productId,
      requirements: page.map((requirement) => ({
        requirementKey: requirement.requirement_key,
        identifier: requirement.identifier,
        heading: requirement.heading,
        text: requirement.text,
        parentKey: requirement.parent_requirement_key,
        controls: activeMappings
          .filter((row) => row.requirement_key === requirement.requirement_key)
          .map((row) => controlById.get(row.control_id))
          .filter((row): row is NonNullable<typeof row> => !!row)
          .map((row) => ({
            id: row.id,
            title: row.title,
            status: row.implementation_status,
            ownerActive: owners.has(row.owner_user_id),
            evidencePresent: evidenceControlIds.has(row.id),
          })),
      })),
      nextCursor: nextCursor(offset, input.limit, requirements.length),
    });
  }

  async command(
    orgId: string,
    input: Parameters<ControlRepository["command"]>[1],
  ) {
    const { data, error } = await this.supabase
      .admin()
      .rpc("m10_control_command", {
        p_organization_id: orgId,
        p_actor_user_id: input.actorId,
        p_operation: input.operation,
        p_payload: input.payload as Json,
        p_expected_revision: input.expectedRevision as number,
        p_idempotency_key: input.idempotencyKey,
      });
    if (error || !data) throw unavailable();
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== "object" || !("outcome" in row))
      throw unavailable();
    if (row.outcome === "conflict") throw new ControlConflictError();
    if (row.outcome === "forbidden") throw new ControlForbiddenError();
    if (row.outcome === "invalid_request")
      throw new ControlInvalidRequestError();
    if (row.outcome === "blocked") throw new ControlBlockedError();
    if (row.outcome === "not_found") throw new ControlNotFoundError();
    if (
      ![
        "created",
        "updated",
        "archived",
        "linked",
        "unlinked",
        "mapped",
        "unmapped",
        "unchanged",
      ].includes(row.outcome)
    )
      throw unavailable();
    return controlCommandResponseSchema.parse(row.result);
  }

  private summary(
    row: {
      id: string;
      title: string;
      description: string;
      owner_user_id: string;
      implementation_status: string;
      revision: number;
      archived_at: string | null;
      created_at: string;
      updated_at: string;
    },
    owners: ReadonlySet<string>,
  ): z.output<typeof controlListResponseSchema>["controls"][number] {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      ownerUserId: row.owner_user_id,
      ownerActive: owners.has(row.owner_user_id),
      status: row.implementation_status as
        "not_started" | "in_progress" | "implemented",
      revision: row.revision,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async activeOwnerIds(
    orgId: string,
    ids: readonly string[],
  ): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const [membersResult, usersResult] = await Promise.all([
      this.supabase
        .admin()
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", orgId)
        .in("user_id", [...new Set(ids)]),
      this.supabase
        .admin()
        .from("users")
        .select("id")
        .eq("is_active", true)
        .in("id", [...new Set(ids)]),
    ]);
    if (
      membersResult.error ||
      usersResult.error ||
      !membersResult.data ||
      !usersResult.data
    )
      throw unavailable();
    const active = new Set(usersResult.data.map((row) => row.id));
    return new Set(
      membersResult.data
        .map((row) => row.user_id)
        .filter((id) => active.has(id)),
    );
  }

  private async deletionDocumentIds(
    orgId: string,
    documentIds: readonly string[],
  ): Promise<Set<string>> {
    if (!documentIds.length) return new Set();
    const { data, error } = await this.supabase
      .admin()
      .from("evidence_document_deletion_intents")
      .select("document_id")
      .eq("organization_id", orgId)
      .in("document_id", [...new Set(documentIds)])
      .in("state", ["queued", "claimed", "failed", "completed"])
      .limit(10_001);
    if (error || !data || data.length > 10_000) throw unavailable();
    return new Set(data.map((row) => row.document_id));
  }

  private async requirementDetails(
    references: readonly {
      packKey: string;
      versionKey: string;
      requirementKey: string;
    }[],
  ): Promise<
    Map<string, { identifier: string; heading: string | null; text: string }>
  > {
    const result = new Map<
      string,
      { identifier: string; heading: string | null; text: string }
    >();
    const grouped = new Map<string, Set<string>>();
    for (const reference of references) {
      const groupKey = `${reference.packKey}:${reference.versionKey}`;
      const keys = grouped.get(groupKey) ?? new Set<string>();
      keys.add(reference.requirementKey);
      grouped.set(groupKey, keys);
    }
    for (const [groupKey, keys] of grouped) {
      const separator = groupKey.indexOf(":");
      const packKey = groupKey.slice(0, separator);
      const versionKey = groupKey.slice(separator + 1);
      const { data, error } = await this.supabase
        .admin()
        .from("framework_requirements")
        .select("requirement_key,identifier,heading,text")
        .eq("pack_key", packKey)
        .eq("version_key", versionKey)
        .in("requirement_key", [...keys])
        .limit(101);
      if (error || !data || data.length !== keys.size) throw unavailable();
      for (const row of data)
        result.set(`${groupKey}:${row.requirement_key}`, row);
    }
    return result;
  }

  private async verifyMembership(
    orgId: string,
    actorId: string,
  ): Promise<void> {
    const client = this.supabase.admin();
    const { data, error } = await client
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("user_id", actorId)
      .maybeSingle();
    if (error) throw unavailable();
    if (!data) throw new ControlForbiddenError();
    const [
      { data: user, error: userError },
      { data: organization, error: orgError },
    ] = await Promise.all([
      client
        .from("users")
        .select("id")
        .eq("id", actorId)
        .eq("is_active", true)
        .maybeSingle(),
      client
        .from("organizations")
        .select("id")
        .eq("id", orgId)
        .eq("is_active", true)
        .maybeSingle(),
    ]);
    if (userError || orgError) throw unavailable();
    if (!user || !organization) throw new ControlForbiddenError();
  }
}
