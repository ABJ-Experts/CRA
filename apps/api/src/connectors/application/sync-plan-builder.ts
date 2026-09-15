import {
  decideFieldAction,
  type FieldAuthorityPolicy,
} from "./field-authority-policy";
import {
  matchExternalProductRecord,
  matchExternalReleaseRecord,
  normalizeIdentity,
  type ProductIdentityCandidate,
  type ReleaseIdentityCandidate,
} from "./identity-matching-policy";
import type { ExternalRecord } from "./connector-port";
import { planEmbeddedParent, type PlanIssue } from "./embedded-parent-planner";

/** product|release field names field_authority_policies governs (mirrors m2_v2_valid_field_authority_field). */
const PRODUCT_POLICY_FIELDS = [
  "name",
  "internalCode",
  "productType",
  "description",
  "parentExternalId",
] as const;
const PRODUCT_MATERIAL_FIELDS = [
  "name",
  "internalCode",
  "productType",
  "description",
] as const;
const RELEASE_POLICY_FIELDS = [
  "label",
  "releaseVersion",
  "description",
] as const;

export type PlanProposedAction =
  | "create"
  | "update"
  | "unchanged"
  | "archive"
  | "conflict"
  | "ambiguous_match"
  | "pending_required_fields"
  | "rejected"
  | "skipped_tombstone";

export type PlanItem = Readonly<{
  externalId: string;
  entityType: "product" | "release";
  proposedAction: PlanProposedAction;
  fieldDiffs: Readonly<Record<string, PlanFieldDiff>>;
  issues: readonly Readonly<{
    code: string;
    message: string;
    severity: "warning" | "error";
  }>[];
  craProductId: string | null;
  craReleaseId: string | null;
  expectedVersion: number | null;
}>;

/**
 * The single persisted plan shape. It deliberately carries both values and
 * the policy that made the decision so a later commit never has to re-fetch
 * or reinterpret an external payload.
 */
export type PlanFieldDiff = Readonly<{
  field: string;
  craValue: unknown;
  externalValue: unknown;
  authorityPolicyId: string | null;
  permittedActions: readonly (
    "accept_external" | "keep_cra" | "enter_manual_value"
  )[];
}>;

export type PlanConflict = Readonly<{
  externalIdentityId: string | null;
  /** Binds a first-seen child conflict to a dry-run plan item until the
   * product materialization transaction creates its durable identity. */
  planItemExternalId: string | null;
  entityType: PlanItem["entityType"];
  entityId: string | null;
  fieldPath: string;
  conflictKind: "field_value";
  craValue: unknown;
  craValueSource: "cra_manual_entry" | "prior_sync_apply";
  craValueObservedAt: string;
  externalValue: unknown;
  externalValueHash: string;
  externalValueObservedAt: string;
  authorityPolicyId: string | null;
  authorityPolicySnapshot: Readonly<Record<string, unknown>>;
  permittedActions: readonly string[];
}>;

export type ActiveProductExternalMapping = Readonly<{
  identityId: string;
  craProductId: string;
}>;

export type ConnectorOwnedParent =
  | Readonly<{ outcome: "none" }>
  | Readonly<{ outcome: "one"; parentProductId: string }>
  | Readonly<{
      outcome: "ambiguous";
      parentProductIds: readonly string[];
    }>;

/** Everything the builder needs pre-fetched by the caller (the worker) -- kept
 * as plain data rather than an injected port, since there is exactly one
 * implementation (Supabase) and a port here would be indirection with no
 * second caller to justify it. */
export type SyncPlanContext = Readonly<{
  organizationId: string;
  connectorId: string;
  defaultOwnerBinding: Readonly<{
    responsibleOwnerId: string;
    legalEntityId: string;
  }> | null;
  findActiveMapping: (
    entityType: "product" | "release",
    externalIdNormalized: string,
  ) => Promise<Readonly<{
    id: string;
    craProductId: string;
    craReleaseId: string | null;
  }> | null>;
  findProductCandidatesByCode: (
    normalizedCode: string,
  ) => Promise<readonly ProductIdentityCandidate[]>;
  findReleaseCandidatesByVersion: (
    productId: string,
    normalizedVersion: string,
  ) => Promise<readonly ReleaseIdentityCandidate[]>;
  getActiveProductMappingsForExternalParent: (
    parentExternalIdNormalized: string,
  ) => Promise<readonly ActiveProductExternalMapping[]>;
  /**
   * Only returns a current, active embedded edge stamped as owned by this
   * connector. Manual and other-connector edges intentionally read as null:
   * a connector must never treat them as its own to replace or end.
   */
  getConnectorOwnedParent: (
    childProductId: string,
  ) => Promise<ConnectorOwnedParent>;
  /** Uses the established M2 graph preview instead of duplicating graph rules
   * in the connector boundary. The caller scopes this lookup by organization.
   */
  wouldCreateEmbeddedComponentCycle: (
    parentProductId: string,
    childProductId: string,
  ) => Promise<boolean>;
  /** True only when the current pulled page contains an unambiguous product
   * record with the normalized external identifier. It lets commit defer an
   * edge until same-run product materialization without accepting unresolved
   * identities from another page. */
  isProductExternalIdPlanned: (externalIdNormalized: string) => boolean;
  getProductFields: (productId: string) => Promise<Readonly<{
    name: string;
    internalCode: string;
    productType: string;
    description: string | null;
    version: number;
  }> | null>;
  getReleaseFields: (
    productId: string,
    releaseId: string,
  ) => Promise<Readonly<{
    label: string;
    releaseVersion: string;
    description: string | null;
    version: number;
  }> | null>;
  getFieldAuthorityPolicy: (
    entityType: "product" | "release",
    field: string,
  ) => Promise<FieldAuthorityPolicy | null>;
  hashValue: (value: unknown) => string;
  nowIso: () => string;
}>;

async function policiesFor(
  ctx: SyncPlanContext,
  entityType: "product" | "release",
): Promise<ReadonlyMap<string, FieldAuthorityPolicy | null>> {
  const fields =
    entityType === "product" ? PRODUCT_POLICY_FIELDS : RELEASE_POLICY_FIELDS;
  const entries = await Promise.all(
    fields.map(
      async (field) =>
        [field, await ctx.getFieldAuthorityPolicy(entityType, field)] as const,
    ),
  );
  return new Map(entries);
}

function planFieldDiff(
  field: string,
  craValue: unknown,
  externalValue: unknown,
  policy: FieldAuthorityPolicy | null,
  permittedActions: PlanFieldDiff["permittedActions"] = ["accept_external"],
): PlanFieldDiff {
  return {
    field,
    craValue,
    externalValue,
    authorityPolicyId: policy?.id ?? null,
    permittedActions,
  };
}

function configurationFieldDiff(field: string, value: string): PlanFieldDiff {
  return planFieldDiff(field, null, value, null, []);
}

function mayCreateFromExternal(policy: FieldAuthorityPolicy | null): boolean {
  return (
    policy !== null &&
    !policy.protected &&
    (policy.policyValue === "external_authoritative" ||
      policy.policyValue === "newest_with_review")
  );
}

function createPolicyIssue(
  policies: ReadonlyMap<string, FieldAuthorityPolicy | null>,
  fields: readonly string[],
): Readonly<{ code: string; message: string; severity: "error" }> | null {
  const disallowed = fields.filter(
    (field) => !mayCreateFromExternal(policies.get(field) ?? null),
  );
  if (disallowed.length === 0) return null;
  return {
    code: "missing_or_non_authoritative_create_policy",
    message: `External creation is blocked until ${disallowed.join(", ")} has an approved unprotected authority policy.`,
    severity: "error",
  };
}

/** Plans one external record against current CRA state. Never mutates anything. */
export async function planExternalRecord(
  ctx: SyncPlanContext,
  record: ExternalRecord,
): Promise<Readonly<{ item: PlanItem; conflicts: readonly PlanConflict[] }>> {
  const externalIdNormalized = normalizeIdentity(record.externalId);
  const existing = await ctx.findActiveMapping(
    record.entityType,
    externalIdNormalized,
  );

  if (record.changeKind === "tombstone") {
    if (record.tombstoneReliability !== "confirmed" || !existing) {
      return {
        item: {
          externalId: record.externalId,
          entityType: record.entityType,
          proposedAction: "skipped_tombstone",
          fieldDiffs: {},
          issues: [
            {
              code: "tombstone_unreliable_or_unmapped",
              message:
                "Tombstone ignored: not confirmed or not currently mapped.",
              severity: "warning",
            },
          ],
          craProductId: existing?.craProductId ?? null,
          craReleaseId: existing?.craReleaseId ?? null,
          expectedVersion: null,
        },
        conflicts: [],
      };
    }
    const current =
      record.entityType === "product"
        ? await ctx.getProductFields(existing.craProductId)
        : existing.craReleaseId
          ? await ctx.getReleaseFields(
              existing.craProductId,
              existing.craReleaseId,
            )
          : null;
    return {
      item: {
        externalId: record.externalId,
        entityType: record.entityType,
        proposedAction: "archive",
        fieldDiffs: {},
        issues: [],
        craProductId: existing.craProductId,
        craReleaseId: existing.craReleaseId,
        expectedVersion: current?.version ?? null,
      },
      conflicts: [],
    };
  }

  const policies = await policiesFor(ctx, record.entityType);
  const fields =
    record.entityType === "product"
      ? PRODUCT_MATERIAL_FIELDS
      : RELEASE_POLICY_FIELDS;

  if (existing) {
    const current =
      record.entityType === "product"
        ? await ctx.getProductFields(existing.craProductId)
        : existing.craReleaseId
          ? await ctx.getReleaseFields(
              existing.craProductId,
              existing.craReleaseId,
            )
          : null;
    if (!current) {
      return {
        item: {
          externalId: record.externalId,
          entityType: record.entityType,
          proposedAction: "rejected",
          fieldDiffs: {},
          issues: [
            {
              code: "mapped_entity_missing",
              message: "The mapped CRA entity no longer exists.",
              severity: "error",
            },
          ],
          craProductId: existing.craProductId,
          craReleaseId: existing.craReleaseId,
          expectedVersion: null,
        },
        conflicts: [],
      };
    }

    const fieldDiffs: Record<string, PlanFieldDiff> = {};
    const issues: PlanIssue[] = [];
    const conflicts: PlanConflict[] = [];
    let anyChange = false;
    for (const field of fields) {
      const externalValue = record.fields[wireToExternalKey(field)] ?? null;
      const craValue =
        (current as Record<string, unknown>)[wireToLocalKey(field)] ?? null;
      const policy = policies.get(field) ?? null;
      const action = decideFieldAction({
        policy,
        craValue,
        craObservedAt: ctx.nowIso(),
        externalValue,
        externalObservedAt: record.externalUpdatedAt,
      });
      if (action === "apply_external") {
        fieldDiffs[field] = planFieldDiff(
          field,
          craValue,
          externalValue,
          policy,
        );
        anyChange = true;
      } else if (
        action === "keep_cra" &&
        !valuesEqual(craValue, externalValue)
      ) {
        issues.push({
          code: "cra_authoritative_change_ignored",
          message: `External ${field} differs but CRA remains authoritative.`,
          severity: "warning",
        });
      } else if (action === "raise_conflict") {
        conflicts.push({
          externalIdentityId: existing.id,
          planItemExternalId: null,
          entityType: record.entityType,
          entityId:
            record.entityType === "release"
              ? existing.craReleaseId
              : existing.craProductId,
          fieldPath: field,
          conflictKind: "field_value",
          craValue,
          craValueSource: "prior_sync_apply",
          craValueObservedAt: ctx.nowIso(),
          externalValue,
          externalValueHash: ctx.hashValue(externalValue),
          externalValueObservedAt: record.externalUpdatedAt,
          authorityPolicyId: policy?.id ?? null,
          authorityPolicySnapshot: policy ?? {},
          permittedActions: policy?.protected
            ? ["keep_cra", "enter_manual_value"]
            : ["accept_external", "keep_cra", "enter_manual_value"],
        });
      }
    }

    if (record.entityType === "product") {
      const parent = await planEmbeddedParent(ctx, {
        record,
        existing: {
          id: existing.id,
          craProductId: existing.craProductId,
        },
        policy: policies.get("parentExternalId") ?? null,
      });
      if (parent.fieldDiff) {
        fieldDiffs.parentExternalId = parent.fieldDiff;
      }
      if (parent.issue) issues.push(parent.issue);
      if (parent.conflict) conflicts.push(parent.conflict);
    }

    return {
      item: {
        externalId: record.externalId,
        entityType: record.entityType,
        proposedAction:
          conflicts.length > 0
            ? "conflict"
            : anyChange
              ? "update"
              : "unchanged",
        fieldDiffs,
        issues,
        craProductId: existing.craProductId,
        craReleaseId: existing.craReleaseId,
        expectedVersion: current.version,
      },
      conflicts,
    };
  }

  // No existing mapping -- attempt bootstrap identity matching by normalized code/version.
  if (record.entityType === "product") {
    const internalCode =
      typeof record.fields.internalCode === "string"
        ? record.fields.internalCode
        : null;
    const candidates = internalCode
      ? await ctx.findProductCandidatesByCode(normalizeIdentity(internalCode))
      : [];
    const match = matchExternalProductRecord({
      externalId: record.externalId,
      existingActiveMapping: null,
      internalCode,
      candidateProductsByNormalizedCode: candidates,
    });
    if (match.outcome === "ambiguous") {
      return {
        item: {
          externalId: record.externalId,
          entityType: "product",
          proposedAction: "ambiguous_match",
          fieldDiffs: {},
          issues: [
            {
              code: "ambiguous_identity_match",
              message:
                "Multiple CRA products could match this external record.",
              severity: "error",
            },
          ],
          craProductId: null,
          craReleaseId: null,
          expectedVersion: null,
        },
        conflicts: [],
      };
    }
    const initialParent = await planEmbeddedParent(ctx, {
      record,
      existing: null,
      policy: policies.get("parentExternalId") ?? null,
    });
    if (!ctx.defaultOwnerBinding) {
      const createIssue = createPolicyIssue(policies, PRODUCT_MATERIAL_FIELDS);
      return {
        item: {
          externalId: record.externalId,
          entityType: "product",
          proposedAction: "pending_required_fields",
          fieldDiffs: {
            name: planFieldDiff(
              "name",
              null,
              record.fields.name ?? null,
              policies.get("name") ?? null,
            ),
            internalCode: planFieldDiff(
              "internalCode",
              null,
              record.fields.internalCode ?? null,
              policies.get("internalCode") ?? null,
            ),
            productType: planFieldDiff(
              "productType",
              null,
              record.fields.productType ?? null,
              policies.get("productType") ?? null,
            ),
            description: planFieldDiff(
              "description",
              null,
              record.fields.description ?? null,
              policies.get("description") ?? null,
            ),
          },
          issues: [
            {
              code: "missing_default_owner_binding",
              message:
                "No default responsible owner / legal entity configured for this connector.",
              severity: "error",
            },
            ...(createIssue ? [createIssue] : []),
            ...(initialParent.issue ? [initialParent.issue] : []),
          ],
          craProductId: null,
          craReleaseId: null,
          expectedVersion: null,
        },
        conflicts: [],
      };
    }
    const createIssue = createPolicyIssue(policies, PRODUCT_MATERIAL_FIELDS);
    if (createIssue) {
      return {
        item: {
          externalId: record.externalId,
          entityType: "product",
          proposedAction: "pending_required_fields",
          fieldDiffs: {
            name: planFieldDiff(
              "name",
              null,
              record.fields.name ?? null,
              policies.get("name") ?? null,
            ),
            internalCode: planFieldDiff(
              "internalCode",
              null,
              record.fields.internalCode ?? null,
              policies.get("internalCode") ?? null,
            ),
            productType: planFieldDiff(
              "productType",
              null,
              record.fields.productType ?? null,
              policies.get("productType") ?? null,
            ),
            description: planFieldDiff(
              "description",
              null,
              record.fields.description ?? null,
              policies.get("description") ?? null,
            ),
          },
          issues: [
            createIssue,
            ...(initialParent.issue ? [initialParent.issue] : []),
          ],
          craProductId: null,
          craReleaseId: null,
          expectedVersion: null,
        },
        conflicts: [],
      };
    }
    return {
      item: {
        externalId: record.externalId,
        entityType: "product",
        proposedAction: "create",
        fieldDiffs: {
          name: planFieldDiff(
            "name",
            null,
            record.fields.name ?? null,
            policies.get("name") ?? null,
          ),
          internalCode: planFieldDiff(
            "internalCode",
            null,
            record.fields.internalCode ?? null,
            policies.get("internalCode") ?? null,
          ),
          productType: planFieldDiff(
            "productType",
            null,
            record.fields.productType ?? null,
            policies.get("productType") ?? null,
          ),
          description: planFieldDiff(
            "description",
            null,
            record.fields.description ?? null,
            policies.get("description") ?? null,
          ),
          responsibleOwnerId: configurationFieldDiff(
            "responsibleOwnerId",
            ctx.defaultOwnerBinding.responsibleOwnerId,
          ),
          legalEntityId: configurationFieldDiff(
            "legalEntityId",
            ctx.defaultOwnerBinding.legalEntityId,
          ),
          ...(initialParent.fieldDiff
            ? { parentExternalId: initialParent.fieldDiff }
            : {}),
        },
        issues: initialParent.issue ? [initialParent.issue] : [],
        craProductId: null,
        craReleaseId: null,
        expectedVersion: null,
      },
      conflicts: initialParent.conflict ? [initialParent.conflict] : [],
    };
  }

  // Release: parent must already resolve to exactly one active product mapping.
  const parentMappings = record.parentExternalId
    ? await ctx.getActiveProductMappingsForExternalParent(
        normalizeIdentity(record.parentExternalId),
      )
    : [];
  const parentIds = parentMappings.map((mapping) => mapping.craProductId);
  const releaseVersion =
    typeof record.fields.releaseVersion === "string"
      ? record.fields.releaseVersion
      : null;
  const releaseCandidates =
    parentIds.length === 1 && releaseVersion
      ? await ctx.findReleaseCandidatesByVersion(
          parentIds[0]!,
          normalizeIdentity(releaseVersion),
        )
      : [];
  const match = matchExternalReleaseRecord({
    externalId: record.externalId,
    existingActiveMapping: null,
    releaseVersion,
    parentActiveProductMappingIds: parentIds,
    candidateReleasesByNormalizedVersion: releaseCandidates,
  });
  if (match.outcome === "ambiguous") {
    return {
      item: {
        externalId: record.externalId,
        entityType: "release",
        proposedAction: "ambiguous_match",
        fieldDiffs: {},
        issues: [
          {
            code: "ambiguous_identity_match",
            message: "The parent product or release match is ambiguous.",
            severity: "error",
          },
        ],
        craProductId: parentIds[0] ?? null,
        craReleaseId: null,
        expectedVersion: null,
      },
      conflicts: [],
    };
  }
  if (parentIds.length !== 1) {
    return {
      item: {
        externalId: record.externalId,
        entityType: "release",
        proposedAction: "pending_required_fields",
        fieldDiffs: {
          label: planFieldDiff(
            "label",
            null,
            record.fields.label ?? null,
            policies.get("label") ?? null,
          ),
          releaseVersion: planFieldDiff(
            "releaseVersion",
            null,
            record.fields.releaseVersion ?? null,
            policies.get("releaseVersion") ?? null,
          ),
        },
        issues: [
          {
            code: "missing_parent_product",
            message: "The parent product is not yet mapped for this connector.",
            severity: "error",
          },
        ],
        craProductId: null,
        craReleaseId: null,
        expectedVersion: null,
      },
      conflicts: [],
    };
  }
  const createIssue = createPolicyIssue(policies, RELEASE_POLICY_FIELDS);
  if (createIssue) {
    return {
      item: {
        externalId: record.externalId,
        entityType: "release",
        proposedAction: "pending_required_fields",
        fieldDiffs: {
          label: planFieldDiff(
            "label",
            null,
            record.fields.label ?? null,
            policies.get("label") ?? null,
          ),
          releaseVersion: planFieldDiff(
            "releaseVersion",
            null,
            record.fields.releaseVersion ?? null,
            policies.get("releaseVersion") ?? null,
          ),
          description: planFieldDiff(
            "description",
            null,
            record.fields.description ?? null,
            policies.get("description") ?? null,
          ),
        },
        issues: [createIssue],
        craProductId: parentIds[0]!,
        craReleaseId: null,
        expectedVersion: null,
      },
      conflicts: [],
    };
  }
  return {
    item: {
      externalId: record.externalId,
      entityType: "release",
      proposedAction: "create",
      fieldDiffs: {
        label: planFieldDiff(
          "label",
          null,
          record.fields.label ?? null,
          policies.get("label") ?? null,
        ),
        releaseVersion: planFieldDiff(
          "releaseVersion",
          null,
          record.fields.releaseVersion ?? null,
          policies.get("releaseVersion") ?? null,
        ),
        description: planFieldDiff(
          "description",
          null,
          record.fields.description ?? null,
          policies.get("description") ?? null,
        ),
      },
      issues: [],
      craProductId: parentIds[0]!,
      craReleaseId: null,
      expectedVersion: null,
    },
    conflicts: [],
  };
}

function wireToExternalKey(field: string): string {
  return field;
}
function wireToLocalKey(field: string): string {
  const map: Record<string, string> = {
    name: "name",
    internalCode: "internalCode",
    productType: "productType",
    description: "description",
    label: "label",
    releaseVersion: "releaseVersion",
  };
  return map[field] ?? field;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== typeof right)
    return false;
  return typeof left === "object"
    ? JSON.stringify(left) === JSON.stringify(right)
    : false;
}
