import type { ExternalRecord } from "./connector-port";
import type { FieldAuthorityPolicy } from "./field-authority-policy";
import { planExternalRecord, type SyncPlanContext } from "./sync-plan-builder";

const externalPolicy: FieldAuthorityPolicy = {
  id: "policy-external",
  policyVersion: 1,
  policyValue: "external_authoritative",
  protected: false,
};

const manualPolicy: FieldAuthorityPolicy = {
  ...externalPolicy,
  id: "policy-manual",
  policyValue: "manual_only",
};

function productRecord(
  overrides: Partial<ExternalRecord> = {},
): ExternalRecord {
  return {
    entityType: "product",
    externalId: "CHILD-EXT",
    externalDisplayLabel: "Child",
    externalUpdatedAt: "2026-08-20T10:00:00.000Z",
    changeKind: "upsert",
    tombstoneReliability: "unknown",
    parentExternalId: "PARENT-EXT",
    fields: {
      name: "Child",
      internalCode: "CHILD-001",
      productType: "component",
      description: null,
    },
    ...overrides,
  };
}

function releaseRecord(): ExternalRecord {
  return {
    entityType: "release",
    externalId: "RELEASE-EXT",
    externalDisplayLabel: "Release 2",
    externalUpdatedAt: "2026-08-20T10:00:00.000Z",
    changeKind: "upsert",
    tombstoneReliability: "unknown",
    parentExternalId: "PARENT-EXT",
    fields: {
      label: "Release 2",
      releaseVersion: "2.0",
      description: null,
    },
  };
}

function context(overrides: Partial<SyncPlanContext> = {}): SyncPlanContext {
  return {
    organizationId: "org-1",
    connectorId: "connector-1",
    defaultOwnerBinding: null,
    findActiveMapping: jest.fn().mockResolvedValue({
      id: "child-identity",
      craProductId: "child-product",
      craReleaseId: null,
    }),
    findProductCandidatesByCode: jest.fn().mockResolvedValue([]),
    findReleaseCandidatesByVersion: jest.fn().mockResolvedValue([]),
    getActiveProductMappingsForExternalParent: jest
      .fn()
      .mockResolvedValue([
        { identityId: "parent-identity", craProductId: "parent-product" },
      ]),
    getConnectorOwnedParent: jest
      .fn()
      .mockResolvedValue({ outcome: "one", parentProductId: "old-parent" }),
    wouldCreateEmbeddedComponentCycle: jest.fn().mockResolvedValue(false),
    isProductExternalIdPlanned: jest.fn().mockReturnValue(false),
    getProductFields: jest.fn().mockResolvedValue({
      name: "Child",
      internalCode: "CHILD-001",
      productType: "component",
      description: null,
      version: 3,
    }),
    getReleaseFields: jest.fn().mockResolvedValue(null),
    getFieldAuthorityPolicy: jest
      .fn()
      .mockImplementation((_entity, field) =>
        Promise.resolve(
          field === "parentExternalId" ? externalPolicy : externalPolicy,
        ),
      ),
    hashValue: (value) => `hash:${JSON.stringify(value)}`,
    nowIso: () => "2026-08-20T10:01:00.000Z",
    ...overrides,
  };
}

describe("planExternalRecord embedded parent planning", () => {
  it("fails closed with a canonical diff when the parent field has no authority policy", async () => {
    const result = await planExternalRecord(
      context({
        getFieldAuthorityPolicy: jest
          .fn()
          .mockImplementation((_entity, field) =>
            Promise.resolve(
              field === "parentExternalId" ? null : externalPolicy,
            ),
          ),
      }),
      productRecord(),
    );

    expect(result.item.proposedAction).toBe("conflict");
    expect(result.item.fieldDiffs.parentExternalId).toEqual({
      field: "parentExternalId",
      craValue: "old-parent",
      externalValue: {
        externalId: "PARENT-EXT",
        craParentProductId: "parent-product",
        parentExternalIdentityId: "parent-identity",
        materializedInPlan: false,
      },
      authorityPolicyId: null,
      permittedActions: ["keep_cra", "enter_manual_value"],
    });
    expect(result.item.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_parent_authority_policy" }),
      ]),
    );
    expect(result.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldPath: "parentExternalId",
          authorityPolicyId: null,
          permittedActions: ["keep_cra", "enter_manual_value"],
        }),
      ]),
    );
  });

  it("keeps an unresolved parent non-mutating and reviewable", async () => {
    const result = await planExternalRecord(
      context({
        getActiveProductMappingsForExternalParent: jest
          .fn()
          .mockResolvedValue([]),
      }),
      productRecord(),
    );

    expect(result.item.proposedAction).toBe("conflict");
    expect(result.item.fieldDiffs.parentExternalId?.externalValue).toEqual({
      externalId: "PARENT-EXT",
      craParentProductId: null,
      parentExternalIdentityId: null,
      materializedInPlan: false,
    });
    expect(result.item.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "embedded_parent_unresolved" }),
      ]),
    );
    expect(result.conflicts[0]).toMatchObject({
      fieldPath: "parentExternalId",
      permittedActions: ["keep_cra", "enter_manual_value"],
    });
  });

  it("keeps an ambiguous parent non-mutating and reviewable", async () => {
    const result = await planExternalRecord(
      context({
        getActiveProductMappingsForExternalParent: jest.fn().mockResolvedValue([
          { identityId: "parent-a-identity", craProductId: "parent-a" },
          { identityId: "parent-b-identity", craProductId: "parent-b" },
        ]),
      }),
      productRecord(),
    );

    expect(result.item.proposedAction).toBe("conflict");
    expect(result.item.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "embedded_parent_ambiguous" }),
      ]),
    );
    expect(result.conflicts[0]).toMatchObject({
      fieldPath: "parentExternalId",
      permittedActions: ["keep_cra", "enter_manual_value"],
    });
  });

  it("requires review for a resolved parent change even under external authority", async () => {
    const ctx = context();

    const result = await planExternalRecord(ctx, productRecord());

    expect(result.item.proposedAction).toBe("conflict");
    expect(result.item.fieldDiffs.parentExternalId).toEqual({
      field: "parentExternalId",
      craValue: "old-parent",
      externalValue: {
        externalId: "PARENT-EXT",
        craParentProductId: "parent-product",
        parentExternalIdentityId: "parent-identity",
        materializedInPlan: false,
      },
      authorityPolicyId: "policy-external",
      permittedActions: ["accept_external", "keep_cra", "enter_manual_value"],
    });
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        fieldPath: "parentExternalId",
        entityId: "child-product",
      }),
    ]);
  });

  it("does not infer a relationship removal from an omitted parent", async () => {
    const ctx = context();
    const result = await planExternalRecord(
      ctx,
      productRecord({ parentExternalId: null }),
    );

    expect(result.item.proposedAction).toBe("unchanged");
    expect(result.item.fieldDiffs.parentExternalId).toBeUndefined();
    expect(result.conflicts).toEqual([]);
    expect(
      ctx.getActiveProductMappingsForExternalParent,
    ).not.toHaveBeenCalled();
    expect(ctx.getConnectorOwnedParent).not.toHaveBeenCalled();
  });

  it("binds a first-seen child hierarchy conflict to its plan item", async () => {
    const ctx = context({
      defaultOwnerBinding: {
        responsibleOwnerId: "owner-1",
        legalEntityId: "legal-entity-1",
      },
      findActiveMapping: jest.fn().mockResolvedValue(null),
      getActiveProductMappingsForExternalParent: jest
        .fn()
        .mockResolvedValue([]),
      isProductExternalIdPlanned: jest.fn().mockReturnValue(true),
    });

    const result = await planExternalRecord(ctx, productRecord());

    expect(result.item.proposedAction).toBe("create");
    expect(result.item.fieldDiffs.parentExternalId).toEqual({
      field: "parentExternalId",
      craValue: null,
      externalValue: {
        externalId: "PARENT-EXT",
        craParentProductId: null,
        parentExternalIdentityId: null,
        materializedInPlan: true,
      },
      authorityPolicyId: "policy-external",
      permittedActions: ["accept_external", "keep_cra", "enter_manual_value"],
    });
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        externalIdentityId: null,
        planItemExternalId: "CHILD-EXT",
        entityId: null,
        fieldPath: "parentExternalId",
      }),
    ]);
    expect(ctx.getConnectorOwnedParent).not.toHaveBeenCalled();
  });

  it("blocks a cycle with a reviewable conflict", async () => {
    const result = await planExternalRecord(
      context({
        wouldCreateEmbeddedComponentCycle: jest.fn().mockResolvedValue(true),
      }),
      productRecord(),
    );

    expect(result.item.proposedAction).toBe("conflict");
    expect(result.item.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "embedded_parent_cycle_blocked" }),
      ]),
    );
    expect(result.conflicts[0]).toMatchObject({
      fieldPath: "parentExternalId",
      permittedActions: ["keep_cra", "enter_manual_value"],
    });
  });

  it("does not replace an ambiguous connector-owned parent edge", async () => {
    const result = await planExternalRecord(
      context({
        getConnectorOwnedParent: jest.fn().mockResolvedValue({
          outcome: "ambiguous",
          parentProductIds: ["old-parent-a", "old-parent-b"],
        }),
      }),
      productRecord(),
    );

    expect(result.item.proposedAction).toBe("conflict");
    expect(result.item.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "connector_owned_parent_ambiguous" }),
      ]),
    );
    expect(result.item.fieldDiffs.parentExternalId).toMatchObject({
      permittedActions: ["keep_cra", "enter_manual_value"],
    });
  });

  it("blocks a first-seen product that names itself as its embedded parent", async () => {
    const result = await planExternalRecord(
      context({
        defaultOwnerBinding: {
          responsibleOwnerId: "owner-1",
          legalEntityId: "legal-entity-1",
        },
        findActiveMapping: jest.fn().mockResolvedValue(null),
        getActiveProductMappingsForExternalParent: jest
          .fn()
          .mockResolvedValue([]),
        isProductExternalIdPlanned: jest.fn().mockReturnValue(true),
      }),
      productRecord({ parentExternalId: "CHILD-EXT" }),
    );

    expect(result.item.proposedAction).toBe("create");
    expect(result.item.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "embedded_parent_cycle_blocked" }),
      ]),
    );
    expect(result.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalIdentityId: null,
          fieldPath: "parentExternalId",
          permittedActions: ["keep_cra", "enter_manual_value"],
        }),
      ]),
    );
  });

  it("keys a release field conflict to the release rather than its product", async () => {
    const result = await planExternalRecord(
      context({
        findActiveMapping: jest.fn().mockResolvedValue({
          id: "release-identity",
          craProductId: "product-1",
          craReleaseId: "release-1",
        }),
        getReleaseFields: jest.fn().mockResolvedValue({
          label: "Release 1",
          releaseVersion: "1.0",
          description: null,
          version: 2,
        }),
        getFieldAuthorityPolicy: jest.fn().mockResolvedValue(manualPolicy),
      }),
      releaseRecord(),
    );

    expect(result.item.proposedAction).toBe("conflict");
    expect(result.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldPath: "label",
          entityId: "release-1",
        }),
      ]),
    );
  });
});
