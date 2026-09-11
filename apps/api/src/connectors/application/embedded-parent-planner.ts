import type { ExternalRecord } from "./connector-port";
import type { FieldAuthorityPolicy } from "./field-authority-policy";
import { normalizeIdentity } from "./identity-matching-policy";
import type {
  PlanConflict,
  PlanFieldDiff,
  SyncPlanContext,
} from "./sync-plan-builder";

export type PlanIssue = Readonly<{
  code: string;
  message: string;
  severity: "warning" | "error";
}>;

export type EmbeddedParentPlan = Readonly<{
  fieldDiff: PlanFieldDiff | null;
  issue: PlanIssue | null;
  conflict: PlanConflict | null;
}>;

type EmbeddedParentPlanningContext = Pick<
  SyncPlanContext,
  | "getActiveProductMappingsForExternalParent"
  | "getConnectorOwnedParent"
  | "wouldCreateEmbeddedComponentCycle"
  | "isProductExternalIdPlanned"
  | "hashValue"
  | "nowIso"
>;

type ExistingProductIdentity = Readonly<{
  id: string;
  craProductId: string;
}>;

type EmbeddedParentExternalValue = Readonly<{
  externalId: string;
  craParentProductId: string | null;
  parentExternalIdentityId: string | null;
  materializedInPlan: boolean;
}>;

function parentPermittedActions(
  policy: FieldAuthorityPolicy | null,
  mayAcceptExternal: boolean,
): PlanFieldDiff["permittedActions"] {
  const policyMayAccept =
    policy !== null &&
    !policy.protected &&
    (policy.policyValue === "external_authoritative" ||
      policy.policyValue === "newest_with_review");
  return policyMayAccept && mayAcceptExternal
    ? ["accept_external", "keep_cra", "enter_manual_value"]
    : ["keep_cra", "enter_manual_value"];
}

function parentFieldDiff(
  currentParentProductId: string | null,
  externalParent: EmbeddedParentExternalValue,
  policy: FieldAuthorityPolicy | null,
  permittedActions: PlanFieldDiff["permittedActions"],
): PlanFieldDiff {
  return {
    field: "parentExternalId",
    craValue: currentParentProductId,
    externalValue: externalParent,
    authorityPolicyId: policy?.id ?? null,
    permittedActions,
  };
}

function parentConflict(
  ctx: EmbeddedParentPlanningContext,
  input: Readonly<{
    externalIdentityId: string | null;
    planItemExternalId: string | null;
    childProductId: string | null;
    currentParentProductId: string | null;
    externalParent: EmbeddedParentExternalValue;
    externalObservedAt: string;
    policy: FieldAuthorityPolicy | null;
    permittedActions: PlanFieldDiff["permittedActions"];
  }>,
): PlanConflict {
  return {
    externalIdentityId: input.externalIdentityId,
    planItemExternalId: input.planItemExternalId,
    entityType: "product",
    entityId: input.childProductId,
    fieldPath: "parentExternalId",
    conflictKind: "field_value",
    craValue: input.currentParentProductId,
    craValueSource:
      input.currentParentProductId === null
        ? "cra_manual_entry"
        : "prior_sync_apply",
    craValueObservedAt: ctx.nowIso(),
    externalValue: input.externalParent,
    externalValueHash: ctx.hashValue(input.externalParent),
    externalValueObservedAt: input.externalObservedAt,
    authorityPolicyId: input.policy?.id ?? null,
    authorityPolicySnapshot: input.policy ?? {},
    permittedActions: input.permittedActions,
  };
}

/**
 * Parent identity is a policy-controlled relationship field, not a product
 * scalar. A non-null parent is reviewable whenever it would create, replace,
 * or cannot prove an unchanged connector-owned embedded edge. An absent
 * parent is deliberately ignored: an omitted pull record is never an end.
 */
export async function planEmbeddedParent(
  ctx: EmbeddedParentPlanningContext,
  input: Readonly<{
    record: ExternalRecord;
    existing: ExistingProductIdentity | null;
    policy: FieldAuthorityPolicy | null;
  }>,
): Promise<EmbeddedParentPlan> {
  const externalParentId = input.record.parentExternalId;
  if (externalParentId === null) {
    return { fieldDiff: null, issue: null, conflict: null };
  }
  const normalizedParentId = normalizeIdentity(externalParentId);
  const [parentMappings, ownsParent] = await Promise.all([
    ctx.getActiveProductMappingsForExternalParent(normalizedParentId),
    input.existing
      ? ctx.getConnectorOwnedParent(input.existing.craProductId)
      : Promise.resolve({ outcome: "none" as const }),
  ]);
  const parentMapping = parentMappings.length === 1 ? parentMappings[0]! : null;
  const materializedInPlan =
    parentMappings.length === 0 &&
    ctx.isProductExternalIdPlanned(normalizedParentId);
  const externalParent: EmbeddedParentExternalValue = {
    externalId: externalParentId,
    craParentProductId: parentMapping?.craProductId ?? null,
    parentExternalIdentityId: parentMapping?.identityId ?? null,
    materializedInPlan,
  };
  const currentParentProductId =
    ownsParent.outcome === "one" ? ownsParent.parentProductId : null;
  const initialPermittedActions = parentPermittedActions(input.policy, false);
  const fieldDiff = parentFieldDiff(
    currentParentProductId,
    externalParent,
    input.policy,
    initialPermittedActions,
  );

  if (ownsParent.outcome === "ambiguous") {
    return reviewResult({
      ctx,
      input,
      currentParentProductId,
      externalParent,
      fieldDiff,
      code: "connector_owned_parent_ambiguous",
      message:
        "More than one connector-owned embedded parent is active for this child and requires manual repair.",
      permittedActions: initialPermittedActions,
    });
  }

  if (input.policy === null) {
    return reviewResult({
      ctx,
      input,
      currentParentProductId,
      externalParent,
      fieldDiff,
      code: "missing_parent_authority_policy",
      message:
        "The parentExternalId relationship requires an explicit authority policy before review.",
      permittedActions: initialPermittedActions,
    });
  }

  if (parentMappings.length > 1) {
    return reviewResult({
      ctx,
      input,
      currentParentProductId,
      externalParent,
      fieldDiff,
      code: "embedded_parent_ambiguous",
      message:
        "The external embedded parent resolves to multiple CRA products and cannot be auto-linked.",
      permittedActions: initialPermittedActions,
    });
  }

  if (parentMapping === null && !materializedInPlan) {
    return reviewResult({
      ctx,
      input,
      currentParentProductId,
      externalParent,
      fieldDiff,
      code: "embedded_parent_unresolved",
      message:
        "The external embedded parent does not resolve to an active product identity or a product materialized in this plan.",
      permittedActions: initialPermittedActions,
    });
  }

  const selfReference =
    normalizedParentId === normalizeIdentity(input.record.externalId);
  const wouldCreateCycle =
    input.existing !== null &&
    parentMapping !== null &&
    (parentMapping.craProductId === input.existing.craProductId ||
      (await ctx.wouldCreateEmbeddedComponentCycle(
        parentMapping.craProductId,
        input.existing.craProductId,
      )));
  if (selfReference || wouldCreateCycle) {
    return reviewResult({
      ctx,
      input,
      currentParentProductId,
      externalParent,
      fieldDiff,
      code: "embedded_parent_cycle_blocked",
      message:
        "The proposed embedded parent would create a product-structure cycle.",
      permittedActions: initialPermittedActions,
    });
  }

  if (
    parentMapping !== null &&
    currentParentProductId === parentMapping.craProductId
  ) {
    return { fieldDiff: null, issue: null, conflict: null };
  }

  return reviewResult({
    ctx,
    input,
    currentParentProductId,
    externalParent,
    fieldDiff,
    code: "embedded_parent_change_requires_review",
    message:
      "The embedded parent change is held for review; it will not be applied automatically.",
    severity: "warning",
    permittedActions: parentPermittedActions(input.policy, true),
  });
}

function reviewResult(
  input: Readonly<{
    ctx: EmbeddedParentPlanningContext;
    input: Readonly<{
      record: ExternalRecord;
      existing: ExistingProductIdentity | null;
      policy: FieldAuthorityPolicy | null;
    }>;
    currentParentProductId: string | null;
    externalParent: EmbeddedParentExternalValue;
    fieldDiff: PlanFieldDiff;
    code: string;
    message: string;
    severity?: "warning" | "error";
    permittedActions: PlanFieldDiff["permittedActions"];
  }>,
): EmbeddedParentPlan {
  const fieldDiff = {
    ...input.fieldDiff,
    permittedActions: input.permittedActions,
  };
  return {
    fieldDiff,
    issue: {
      code: input.code,
      message: input.message,
      severity: input.severity ?? "error",
    },
    conflict: parentConflict(input.ctx, {
      externalIdentityId: input.input.existing?.id ?? null,
      planItemExternalId: input.input.existing
        ? null
        : input.input.record.externalId,
      childProductId: input.input.existing?.craProductId ?? null,
      currentParentProductId: input.currentParentProductId,
      externalParent: input.externalParent,
      externalObservedAt: input.input.record.externalUpdatedAt,
      policy: input.input.policy,
      permittedActions: input.permittedActions,
    }),
  };
}
