import type { ExternalRecord } from "./connector-port";
import {
  decideFieldAction,
  previewFieldAuthorityImpact,
  type FieldAuthorityPolicy,
} from "./field-authority-policy";

const earlier = "2026-01-01T00:00:00.000Z";
const later = "2026-06-01T00:00:00.000Z";

function policy(
  overrides: Partial<FieldAuthorityPolicy> = {},
): FieldAuthorityPolicy {
  return {
    id: "policy-1",
    policyVersion: 1,
    policyValue: "cra_authoritative",
    protected: false,
    ...overrides,
  };
}

describe("decideFieldAction", () => {
  it("defaults to manual_only, fail-closed, when no policy row exists", () => {
    expect(
      decideFieldAction({
        policy: null,
        craValue: "Gateway",
        craObservedAt: earlier,
        externalValue: "Gateway Pro",
        externalObservedAt: later,
      }),
    ).toBe("raise_conflict");
    expect(
      decideFieldAction({
        policy: null,
        craValue: "Gateway",
        craObservedAt: earlier,
        externalValue: "Gateway",
        externalObservedAt: later,
      }),
    ).toBe("keep_cra");
  });

  it("applies the external value when external_authoritative and values differ", () => {
    expect(
      decideFieldAction({
        policy: policy({ policyValue: "external_authoritative" }),
        craValue: "Gateway",
        craObservedAt: earlier,
        externalValue: "Gateway Pro",
        externalObservedAt: later,
      }),
    ).toBe("apply_external");
    expect(
      decideFieldAction({
        policy: policy({ policyValue: "external_authoritative" }),
        craValue: "Gateway",
        craObservedAt: earlier,
        externalValue: "Gateway",
        externalObservedAt: later,
      }),
    ).toBe("keep_cra");
  });

  it("never auto-applies external_authoritative onto a protected field, defensively", () => {
    expect(
      decideFieldAction({
        policy: policy({
          policyValue: "external_authoritative",
          protected: true,
        }),
        craValue: "Gateway",
        craObservedAt: earlier,
        externalValue: "Gateway Pro",
        externalObservedAt: later,
      }),
    ).toBe("keep_cra");
  });

  it("keeps the CRA value under cra_authoritative regardless of the external value", () => {
    expect(
      decideFieldAction({
        policy: policy({ policyValue: "cra_authoritative" }),
        craValue: "Gateway",
        craObservedAt: later,
        externalValue: "Gateway Pro",
        externalObservedAt: earlier,
      }),
    ).toBe("keep_cra");
  });

  it("raises a conflict under manual_only only when values actually differ", () => {
    expect(
      decideFieldAction({
        policy: policy({ policyValue: "manual_only" }),
        craValue: "Gateway",
        craObservedAt: earlier,
        externalValue: "Gateway Pro",
        externalObservedAt: later,
      }),
    ).toBe("raise_conflict");
    expect(
      decideFieldAction({
        policy: policy({ policyValue: "manual_only" }),
        craValue: "Gateway",
        craObservedAt: earlier,
        externalValue: "Gateway",
        externalObservedAt: later,
      }),
    ).toBe("keep_cra");
  });

  it("applies the newer external value under newest_with_review when unprotected", () => {
    expect(
      decideFieldAction({
        policy: policy({ policyValue: "newest_with_review" }),
        craValue: "Gateway",
        craObservedAt: earlier,
        externalValue: "Gateway Pro",
        externalObservedAt: later,
      }),
    ).toBe("apply_external");
  });

  it("raises a conflict under newest_with_review when the CRA value is newer or equal", () => {
    expect(
      decideFieldAction({
        policy: policy({ policyValue: "newest_with_review" }),
        craValue: "Gateway",
        craObservedAt: later,
        externalValue: "Gateway Pro",
        externalObservedAt: earlier,
      }),
    ).toBe("raise_conflict");
    expect(
      decideFieldAction({
        policy: policy({ policyValue: "newest_with_review" }),
        craValue: "Gateway",
        craObservedAt: earlier,
        externalValue: "Gateway Pro",
        externalObservedAt: earlier,
      }),
    ).toBe("raise_conflict");
  });

  it("raises a conflict under newest_with_review on a protected field even when external is newer", () => {
    expect(
      decideFieldAction({
        policy: policy({ policyValue: "newest_with_review", protected: true }),
        craValue: "Gateway",
        craObservedAt: earlier,
        externalValue: "Gateway Pro",
        externalObservedAt: later,
      }),
    ).toBe("raise_conflict");
  });
});

function externalRecord(
  overrides: Partial<ExternalRecord> = {},
): ExternalRecord {
  return {
    entityType: "product",
    externalId: "EXT-1",
    externalDisplayLabel: "Gateway Pro",
    externalUpdatedAt: later,
    changeKind: "upsert",
    tombstoneReliability: "unknown",
    parentExternalId: null,
    fields: { name: "Gateway Pro" },
    ...overrides,
  };
}

describe("previewFieldAuthorityImpact", () => {
  it("tallies create, update, ignore, and conflict outcomes across a sample", () => {
    const proposedPolicy = policy({ policyValue: "newest_with_review" });
    const result = previewFieldAuthorityImpact({
      proposedPolicy,
      sample: [
        {
          externalRecord: externalRecord({ externalId: "EXT-new" }),
          field: "name",
          craFieldValue: undefined,
          craObservedAt: earlier,
        },
        {
          externalRecord: externalRecord({
            externalId: "EXT-update",
            fields: { name: "Gateway Pro" },
          }),
          field: "name",
          craFieldValue: "Gateway",
          craObservedAt: earlier,
        },
        {
          externalRecord: externalRecord({
            externalId: "EXT-unchanged",
            fields: { name: "Gateway" },
          }),
          field: "name",
          craFieldValue: "Gateway",
          craObservedAt: earlier,
        },
        {
          externalRecord: externalRecord({
            externalId: "EXT-conflict",
            fields: { name: "Gateway Pro" },
            externalUpdatedAt: earlier,
          }),
          field: "name",
          craFieldValue: "Gateway",
          craObservedAt: later,
        },
      ],
    });
    expect(result).toEqual({
      wouldCreate: 1,
      wouldUpdate: 1,
      wouldBeIgnored: 1,
      wouldConflict: 1,
    });
  });
});
