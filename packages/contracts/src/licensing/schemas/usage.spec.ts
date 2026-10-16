import { describe, expect, it } from "vitest";
import {
  LICENSE_USAGE_DEFINITIONS,
  licenseUsageSnapshotSchema,
  licenseUsageOperationInputSchema,
  licenseUsageExportResponseSchema,
  licenseUsageReconciliationResponseSchema,
  licenseUsageQuerySchema,
} from "./usage.schemas.js";

const uuid = "22222222-2222-4222-8222-222222222222";
const timestamp = "2026-10-13T00:00:00.000Z";
function snapshot() {
  return {
    schemaVersion: 1,
    definitionVersion: "m15_02_v1",
    organizationId: uuid,
    observedAt: timestamp,
    meterVersion: 1,
    reconciledAt: null,
    license: {
      version: 1,
      issuanceSequence: 1,
      policyRevision: 1,
      state: "active",
      verified: true,
      reasons: [],
      startsAt: timestamp,
      expiresAt: "2027-10-13T00:00:00.000Z",
      graceEndsAt: "2027-11-12T00:00:00.000Z",
      effectiveCapabilities: ["products"],
    },
    counters: LICENSE_USAGE_DEFINITIONS.map(
      ({ componentKeys, ...definition }) => ({
        ...definition,
        kind: "gauge",
        scope: "organization",
        period: {
          kind: "current_state",
          resetRule: "source_changes_only",
          nextResetAt: null,
        },
        value: 0,
        components: componentKeys.map((key) => ({ key, value: 0 })),
        availability: "ready",
        limit:
          definition.id === "protected_storage"
            ? { kind: "exempt", value: null }
            : { kind: "finite", value: 10 },
        state: "normal",
        reasons: [],
      }),
    ),
  };
}

describe("licence usage contracts", () => {
  it("accepts the fixed current-state aggregate snapshot and audited export", () => {
    const value = snapshot();
    expect(licenseUsageSnapshotSchema.parse(value)).toEqual(value);
    expect(
      licenseUsageExportResponseSchema.parse({
        snapshot: value,
        auditEventId: uuid,
        replayed: false,
      }),
    ).toEqual({ snapshot: value, auditEventId: uuid, replayed: false });
  });

  it.each([
    { schemaVersion: 2 },
    { definitionVersion: "future" },
    { artifact: "private" },
    { memberEmail: "private@example.test" },
    { meterVersion: Number.MAX_SAFE_INTEGER + 1 },
    { observedAt: "2026-10-13T01:00:00+01:00" },
    { reconciledAt: "2027-10-13T00:00:00.000Z" },
  ])("rejects invalid provenance or private fields %j", (patch) => {
    expect(
      licenseUsageSnapshotSchema.safeParse({ ...snapshot(), ...patch }).success,
    ).toBe(false);
  });

  it("rejects tampered definitions, components, periods and derived values", () => {
    for (const patch of [
      { id: "products" },
      { label: "Someone's products" },
      { definition: "invented allowance" },
      { unit: "bytes" },
      { value: 1 },
      { value: Number.MAX_SAFE_INTEGER + 1 },
      { value: -1 },
      { components: [{ key: "activeMembers", value: 0 }] },
      {
        period: {
          kind: "monthly",
          resetRule: "calendar",
          nextResetAt: timestamp,
        },
      },
      { limit: { kind: "exempt", value: null } },
      { reasons: ["person@example.test"] },
      { state: "over_limit" },
    ]) {
      const value = snapshot();
      expect(
        licenseUsageSnapshotSchema.safeParse({
          ...value,
          counters: [
            { ...value.counters[0], ...patch },
            ...value.counters.slice(1),
          ],
        }).success,
      ).toBe(false);
    }
    expect(
      licenseUsageSnapshotSchema.safeParse({ ...snapshot(), counters: [] })
        .success,
    ).toBe(false);
  });

  it("represents unavailable values as null and limits as unverified without trust", () => {
    const value = snapshot();
    const counters = value.counters.map((row) =>
      row.id === "protected_storage"
        ? row
        : {
            ...row,
            limit: { kind: "unverified", value: null },
            state: "unavailable",
          },
    );
    expect(
      licenseUsageSnapshotSchema.safeParse({
        ...value,
        license: {
          ...value.license,
          verified: false,
          effectiveCapabilities: [],
        },
        counters,
      }).success,
    ).toBe(true);
    expect(
      licenseUsageSnapshotSchema.safeParse({
        ...value,
        license: { ...value.license, verified: false },
      }).success,
    ).toBe(false);
    const unavailable = {
      ...value.counters[0],
      availability: "unavailable",
      state: "unavailable",
      value: null,
      components: [
        { key: "activeMembers", value: null },
        { key: "reservedInvitations", value: 0 },
      ],
      reasons: ["meter_unavailable"],
    };
    expect(
      licenseUsageSnapshotSchema.safeParse({
        ...value,
        counters: [unavailable, ...value.counters.slice(1)],
      }).success,
    ).toBe(true);
    expect(
      licenseUsageSnapshotSchema.safeParse({
        ...value,
        counters: [{ ...unavailable, value: 0 }, ...value.counters.slice(1)],
      }).success,
    ).toBe(false);
  });

  it("enforces finite boundary states and verified unlimited diagnostics", () => {
    for (const [used, cap, state] of [
      [0, 0, "at_limit"],
      [8, 10, "near_limit"],
      [10, 10, "at_limit"],
      [11, 10, "over_limit"],
    ] as const) {
      const value = snapshot();
      const row = {
        ...value.counters[1],
        value: used,
        components: [{ key: "products", value: used }],
        limit: { kind: "finite", value: cap },
        state,
      };
      expect(
        licenseUsageSnapshotSchema.safeParse({
          ...value,
          counters: [value.counters[0], row, ...value.counters.slice(2)],
        }).success,
      ).toBe(true);
    }
    const value = snapshot();
    const row = {
      ...value.counters[1],
      limit: { kind: "unlimited", value: null },
    };
    expect(
      licenseUsageSnapshotSchema.safeParse({
        ...value,
        counters: [value.counters[0], row, ...value.counters.slice(2)],
      }).success,
    ).toBe(true);
  });

  it("requires strict optimistic versions and UUID retry identity", () => {
    expect(licenseUsageQuerySchema.parse({})).toEqual({});
    expect(
      licenseUsageQuerySchema.safeParse({ organizationId: uuid }).success,
    ).toBe(false);
    const input = {
      expectedLicenseVersion: 0,
      expectedMeterVersion: 1,
      idempotencyKey: uuid,
    };
    expect(licenseUsageOperationInputSchema.parse(input)).toEqual(input);
    for (const patch of [
      { organizationId: uuid },
      { expectedLicenseVersion: -1 },
      { expectedMeterVersion: 0.5 },
      { expectedMeterVersion: Number.MAX_SAFE_INTEGER + 1 },
      { idempotencyKey: "retry" },
    ]) {
      expect(
        licenseUsageOperationInputSchema.safeParse({ ...input, ...patch })
          .success,
      ).toBe(false);
    }
  });

  it.each([
    { version: 0 },
    { issuanceSequence: null },
    { state: null },
    { state: "missing" },
    { state: "invalid" },
    { state: "clock_untrusted" },
    { state: "expired_read_only" },
  ])("rejects contradictory verified provenance %j", (patch) => {
    const value = snapshot();
    expect(
      licenseUsageSnapshotSchema.safeParse({
        ...value,
        license: { ...value.license, ...patch },
      }).success,
    ).toBe(false);
  });

  it("rejects capabilities without verified provenance", () => {
    const value = snapshot();
    const counters = value.counters.map((row) =>
      row.id === "protected_storage"
        ? row
        : {
            ...row,
            limit: { kind: "unverified", value: null },
            state: "unavailable",
          },
    );
    expect(
      licenseUsageSnapshotSchema.safeParse({
        ...value,
        counters,
        license: { ...value.license, verified: false },
      }).success,
    ).toBe(false);
  });

  it.each(["active", "grace", "expired_read_only"])(
    "accepts verified %s provenance",
    (state) => {
      const value = snapshot();
      expect(
        licenseUsageSnapshotSchema.safeParse({
          ...value,
          observedAt:
            state === "active"
              ? value.observedAt
              : state === "grace"
                ? value.license.expiresAt
                : value.license.graceEndsAt,
          license: {
            ...value.license,
            state,
            effectiveCapabilities:
              state === "expired_read_only" ? [] : ["products"],
          },
        }).success,
      ).toBe(true);
    },
  );

  it("retains signed diagnostic dates under untrusted clock without capabilities or grants", () => {
    const value = snapshot();
    const counters = value.counters.map((row) =>
      row.id === "protected_storage"
        ? row
        : {
            ...row,
            limit: { kind: "unverified", value: null },
            state: "unavailable",
          },
    );
    expect(
      licenseUsageSnapshotSchema.safeParse({
        ...value,
        counters,
        license: {
          ...value.license,
          verified: false,
          state: "clock_untrusted",
          effectiveCapabilities: [],
        },
      }).success,
    ).toBe(true);
  });

  it.each([
    { observedAt: "2026-10-12T23:59:59.999Z" },
    { state: "grace" },
    { observedAt: "2027-10-13T00:00:00.000Z" },
    { state: "grace", observedAt: "2027-11-12T00:00:00.000Z" },
    { state: "expired_read_only", observedAt: "2027-11-11T23:59:59.999Z" },
    { graceEndsAt: "2027-11-11T00:00:00.000Z" },
    { startsAt: "2027-10-13T00:00:00.000Z" },
    { expiresAt: null },
  ])("rejects contradictory verified observation dates %j", (patch) => {
    const value = snapshot();
    const { observedAt = value.observedAt, ...licensePatch } = patch;
    const state = licensePatch.state ?? value.license.state;
    expect(
      licenseUsageSnapshotSchema.safeParse({
        ...value,
        observedAt,
        license: {
          ...value.license,
          ...licensePatch,
          effectiveCapabilities:
            state === "expired_read_only" ? [] : ["products"],
        },
      }).success,
    ).toBe(false);
  });

  it("bounds reconciliation work and excludes source contents", () => {
    const receipt = {
      auditEventId: uuid,
      meterVersion: 1,
      checked: 100,
      repaired: 2,
      released: 100,
      unresolved: 1,
      completedAt: timestamp,
      replayed: true,
    };
    expect(licenseUsageReconciliationResponseSchema.parse(receipt)).toEqual(
      receipt,
    );
    for (const patch of [
      { checked: 101 },
      { released: 101 },
      { repaired: -1 },
      { unresolved: 0.5 },
      { objectPath: "private/path" },
      { repaired: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expect(
        licenseUsageReconciliationResponseSchema.safeParse({
          ...receipt,
          ...patch,
        }).success,
      ).toBe(false);
    }
  });
});
