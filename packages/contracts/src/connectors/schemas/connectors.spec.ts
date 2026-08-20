import { describe, expect, it } from "vitest";

import {
  connectorSchema,
  fieldAuthorityPolicySchema,
  linkExternalIdentityInputSchema,
  productExternalIdentitySchema,
  diagnosticsExportResponseSchema,
  syncRunPlanItemSchema,
  resolveSyncConflictInputSchema,
  syncConflictSchema,
  syncRunSchema,
  testConnectorResultSchema,
  upsertFieldAuthorityPolicyInputSchema,
} from "./index.js";

const id = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const now = "2026-08-17T12:00:00.000Z";

const baseConnector = {
  id,
  organizationId: otherId,
  connectorType: "reference_conformance" as const,
  displayName: "Reference PLM",
  adapterVersion: "1.0.0",
  mappingVersion: "v1",
  connectionConfig: {},
  hasSecret: false,
  commitPolicy: "manual" as const,
  enabled: true,
  lastTestedAt: null,
  lastTestOutcome: null,
  lastTestErrorCode: null,
  archivedAt: null,
  version: 1,
  createdAt: now,
  createdBy: id,
  updatedAt: now,
  updatedBy: id,
};

describe("connector contracts", () => {
  it("parses a connector row without ever accepting a secretRef field", () => {
    expect(connectorSchema.parse(baseConnector)).toMatchObject({
      displayName: "Reference PLM",
    });
    expect(() =>
      connectorSchema.parse({ ...baseConnector, secretRef: id }),
    ).toThrow();
  });

  it("discriminates success and failure test results by their own shape", () => {
    expect(
      testConnectorResultSchema.parse({
        outcome: "success",
        latencyMs: 42,
        adapterVersion: "1.0.0",
      }),
    ).toMatchObject({ outcome: "success" });
    expect(() =>
      testConnectorResultSchema.parse({
        outcome: "success",
        errorCode: "unknown",
      }),
    ).toThrow();
  });
});

describe("field authority policy contracts", () => {
  it("rejects a field name that does not belong to its entity type", () => {
    expect(() =>
      upsertFieldAuthorityPolicyInputSchema.parse({
        entityType: "product",
        fieldName: "releaseVersion",
        policyValue: "cra_authoritative",
        protected: false,
      }),
    ).toThrow();
  });

  it("requires a reason exactly when a field is protected, and forbids external-authoritative protection", () => {
    expect(() =>
      upsertFieldAuthorityPolicyInputSchema.parse({
        entityType: "product",
        fieldName: "name",
        policyValue: "cra_authoritative",
        protected: true,
      }),
    ).toThrow();
    expect(
      upsertFieldAuthorityPolicyInputSchema.parse({
        entityType: "product",
        fieldName: "name",
        policyValue: "cra_authoritative",
        protected: true,
        protectedReason: "Regulated safety field",
        previewDigest: "a".repeat(64),
      }),
    ).toMatchObject({ protected: true });
    expect(() =>
      fieldAuthorityPolicySchema.parse({
        id,
        connectorId: otherId,
        entityType: "release",
        fieldName: "label",
        policyValue: "external_authoritative",
        protected: true,
        protectedReason: "Regulated",
        policyVersion: 1,
      }),
    ).toThrow();
  });

  it("allows the explicit embedded hierarchy authority field only for products", () => {
    expect(
      upsertFieldAuthorityPolicyInputSchema.parse({
        entityType: "product",
        fieldName: "parentExternalId",
        policyValue: "newest_with_review",
        protected: false,
        previewDigest: "a".repeat(64),
      }),
    ).toMatchObject({ fieldName: "parentExternalId" });
    expect(() =>
      upsertFieldAuthorityPolicyInputSchema.parse({
        entityType: "release",
        fieldName: "parentExternalId",
        policyValue: "newest_with_review",
        protected: false,
        previewDigest: "a".repeat(64),
      }),
    ).toThrow();
  });
});

describe("external identity contracts", () => {
  it("ties release identities to a release id and forbids one on a product identity", () => {
    expect(() =>
      linkExternalIdentityInputSchema.parse({
        entityType: "release",
        externalId: "EXT-1",
        craProductId: id,
        matchMethod: "manual_link",
      }),
    ).toThrow();
    expect(() =>
      linkExternalIdentityInputSchema.parse({
        entityType: "product",
        externalId: "EXT-1",
        craProductId: id,
        craReleaseId: otherId,
        matchMethod: "manual_link",
      }),
    ).toThrow();
  });

  it("requires unlink timestamp, actor, and reason to arrive together", () => {
    expect(() =>
      productExternalIdentitySchema.parse({
        id,
        organizationId: otherId,
        connectorId: otherId,
        entityType: "product",
        externalId: "EXT-1",
        externalDisplayLabel: null,
        craProductId: id,
        craReleaseId: null,
        matchMethod: "manual_link",
        matchConfidence: "certain",
        linkedAt: now,
        linkedBy: id,
        unlinkedAt: now,
        unlinkedBy: null,
        unlinkReason: null,
        version: 1,
        createdAt: now,
        createdBy: id,
        updatedAt: now,
        updatedBy: id,
      }),
    ).toThrow();
  });
});

describe("sync run contracts", () => {
  const baseRun = {
    id,
    organizationId: otherId,
    connectorId: otherId,
    reconciliationKind: "incremental" as const,
    workKind: "dry_run" as const,
    adapterVersion: "1.0.0",
    mappingVersion: "v1",
    cursorFrom: null,
    cursorTo: null,
    fetchContentHash: null,
    planBasisDigest: null,
    rowCount: 0,
    counts: {
      create: 0,
      update: 0,
      unchanged: 0,
      skip: 0,
      conflict: 0,
      tombstone: 0,
      cycleBlocked: 0,
    },
    estimatedGraphImpact: {},
    errorCode: null,
    retryCount: 0,
    correlationId: id,
    expiresAt: now,
    committedAt: null,
    canceledAt: null,
    createdAt: now,
    updatedAt: now,
  };

  it("requires a committed timestamp exactly on a completed run", () => {
    expect(() =>
      syncRunSchema.parse({
        ...baseRun,
        status: "completed",
        committedAt: null,
      }),
    ).toThrow();
    expect(
      syncRunSchema.parse({
        ...baseRun,
        status: "completed",
        committedAt: now,
      }),
    ).toMatchObject({ status: "completed" });
  });

  it("keeps every persisted field difference self-describing", () => {
    expect(
      syncRunPlanItemSchema.parse({
        externalId: "PLM-100",
        entityType: "product",
        proposedAction: "update",
        fieldDiffs: {
          name: {
            field: "name",
            craValue: "CRA name",
            externalValue: "PLM name",
            authorityPolicyId: null,
            permittedActions: ["accept_external", "keep_cra"],
          },
        },
        issues: [],
      }),
    ).toMatchObject({ proposedAction: "update" });
    expect(() =>
      syncRunPlanItemSchema.parse({
        externalId: "PLM-100",
        entityType: "product",
        proposedAction: "update",
        fieldDiffs: { name: "PLM name" },
        issues: [],
      }),
    ).toThrow();
  });
});

describe("safe connector diagnostics contracts", () => {
  it("returns a browser-downloadable redacted report instead of a storage URL", () => {
    expect(
      diagnosticsExportResponseSchema.parse({
        filename: "connector-diagnostic-reference-plm.json",
        report: {
          generatedAt: now,
          connectorId: id,
          connectorStatus: "stale",
          cursorAgeSeconds: 90,
          latestRun: null,
          counts: { openConflicts: 0, deadLetters: 0, retries: 0 },
        },
      }),
    ).toMatchObject({ filename: "connector-diagnostic-reference-plm.json" });
    expect(() =>
      diagnosticsExportResponseSchema.parse({
        downloadUrl: "https://unsafe.example/export",
      }),
    ).toThrow();
  });
});

describe("sync conflict contracts", () => {
  const baseConflict = {
    id,
    organizationId: otherId,
    connectorId: otherId,
    syncRunId: otherId,
    externalIdentityId: otherId,
    entityType: "product" as const,
    entityId: id,
    fieldPath: "name",
    conflictKind: "field_value" as const,
    craValue: "Old",
    craValueSource: "cra_manual_entry" as const,
    craValueObservedAt: now,
    externalValue: "New",
    externalValueObservedAt: now,
    detectedAt: now,
    authorityPolicyId: null,
    permittedActions: [
      "accept_external",
      "keep_cra",
      "enter_manual_value",
    ] as const,
    version: 1,
  };

  it("requires resolution fields exactly when a conflict is no longer open", () => {
    expect(() =>
      syncConflictSchema.parse({
        ...baseConflict,
        resolutionStatus: "open",
        resolutionChosenAction: "keep_cra",
        resolutionValue: null,
        resolutionReason: null,
        resolvedBy: null,
        resolvedAt: null,
      }),
    ).toThrow();
    expect(
      syncConflictSchema.parse({
        ...baseConflict,
        resolutionStatus: "resolved",
        resolutionChosenAction: "keep_cra",
        resolutionValue: "Old",
        resolutionReason: "Kept the internal record",
        resolvedBy: id,
        resolvedAt: now,
      }),
    ).toMatchObject({ resolutionStatus: "resolved" });
  });

  it("accepts a plan-bound first-run hierarchy conflict before an identity exists", () => {
    expect(
      syncConflictSchema.parse({
        ...baseConflict,
        externalIdentityId: null,
        entityId: null,
        fieldPath: "parentExternalId",
        craValue: null,
        externalValue: {
          externalId: "PARENT-EXT",
          craParentProductId: null,
          parentExternalIdentityId: null,
          materializedInPlan: true,
        },
        resolutionStatus: "open",
        resolutionChosenAction: null,
        resolutionValue: null,
        resolutionReason: null,
        resolvedBy: null,
        resolvedAt: null,
      }),
    ).toMatchObject({ externalIdentityId: null, fieldPath: "parentExternalId" });
  });

  it("requires a manual value only when the chosen action enters one", () => {
    expect(() =>
      resolveSyncConflictInputSchema.parse({
        expectedVersion: 1,
        chosenAction: "keep_cra",
        manualValue: "Something",
        reason: "Not applicable",
        idempotencyKey: id,
      }),
    ).toThrow();
    expect(() =>
      resolveSyncConflictInputSchema.parse({
        expectedVersion: 1,
        chosenAction: "enter_manual_value",
        reason: "Manual override",
        idempotencyKey: id,
      }),
    ).toThrow();
    expect(
      resolveSyncConflictInputSchema.parse({
        expectedVersion: 1,
        chosenAction: "enter_manual_value",
        manualValue: "Corrected value",
        reason: "Manual override",
        idempotencyKey: id,
      }),
    ).toMatchObject({ chosenAction: "enter_manual_value" });
  });
});
