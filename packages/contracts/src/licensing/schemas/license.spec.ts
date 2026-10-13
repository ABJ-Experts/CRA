import { describe, expect, it } from "vitest";
import {
  licenseClaimsSchema,
  licenseActivationInputSchema,
  licenseArtifactSchema,
  licensePolicyResponseSchema,
} from "./index.js";
import {
  defaultPermissionsFor,
  resolveEffectivePermissions,
} from "../../permissions.js";
export const claims = {
  schemaVersion: 1,
  licenseId: "11111111-1111-4111-8111-111111111111",
  sequence: 1,
  issuer: "cra",
  organizationId: "22222222-2222-4222-8222-222222222222",
  instanceId: "33333333-3333-4333-8333-333333333333",
  issuedAt: "2026-01-01T00:00:00.000Z",
  startsAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-02-01T00:00:00.000Z",
  graceDays: 30,
  entitlements: ["products"],
  limits: { activeMembers: 5, products: null, storageBytes: 1000 },
};
describe("licence contracts", () => {
  it("accepts the pinned schema and nullable unlimited cap", () =>
    expect(licenseClaimsSchema.parse(claims)).toEqual(claims));
  it.each([
    { other: true },
    { graceDays: 29 },
    { entitlements: ["products", "products"] },
    { entitlements: ["unknown"] },
    { sequence: Number.MAX_SAFE_INTEGER + 1 },
    { startsAt: "2027-01-01T00:00:00Z" },
    { limits: { ...claims.limits, storageBytes: -1 } },
  ])("rejects malformed claims %j", (patch) =>
    expect(licenseClaimsSchema.safeParse({ ...claims, ...patch }).success).toBe(
      false,
    ),
  );
  it("passes bounded malformed activation text to the audited verifier", () => {
    expect(
      licenseActivationInputSchema.safeParse({
        artifact: "x",
        expectedVersion: 0,
        idempotencyKey: claims.licenseId,
      }).success,
    ).toBe(true);
    expect(licenseArtifactSchema.safeParse("x").success).toBe(false);
    expect(
      licenseActivationInputSchema.safeParse({
        artifact: "é",
        expectedVersion: 0,
        idempotencyKey: claims.licenseId,
      }).success,
    ).toBe(false);
  });
  it("rejects contradictory read-only policy responses", () => {
    const response = {
      state: "expired_read_only",
      reasons: ["expired_read_only"],
      warnings: [],
      effectiveCapabilities: ["products"],
      disabledCapabilities: [],
      customerWritesAllowed: true,
      evidenceExportAllowed: true,
      evaluatedAt: "2026-03-03T00:00:00.000Z",
      expiresAt: claims.expiresAt,
      graceEndsAt: "2026-03-03T00:00:00.000Z",
    };
    expect(licensePolicyResponseSchema.safeParse(response).success).toBe(false);
    expect(
      licensePolicyResponseSchema.safeParse({
        ...response,
        customerWritesAllowed: false,
        effectiveCapabilities: [],
      }).success,
    ).toBe(true);
    expect(
      licensePolicyResponseSchema.safeParse({
        ...response,
        customerWritesAllowed: false,
        effectiveCapabilities: [],
        graceEndsAt: "2026-03-04T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });
  it("validates policy state/date boundaries and protected export", () => {
    const base = {
      state: "active",
      reasons: [],
      warnings: [],
      effectiveCapabilities: ["products"],
      disabledCapabilities: [],
      customerWritesAllowed: true,
      evidenceExportAllowed: true,
      evaluatedAt: claims.startsAt,
      expiresAt: claims.expiresAt,
      graceEndsAt: "2026-03-03T00:00:00.000Z",
    };
    expect(licensePolicyResponseSchema.safeParse(base).success).toBe(true);
    expect(
      licensePolicyResponseSchema.safeParse({
        ...base,
        state: "grace",
        evaluatedAt: claims.expiresAt,
      }).success,
    ).toBe(true);
    expect(
      licensePolicyResponseSchema.safeParse({ ...base, state: "grace" })
        .success,
    ).toBe(false);
    expect(
      licensePolicyResponseSchema.safeParse({
        ...base,
        evaluatedAt: claims.expiresAt,
      }).success,
    ).toBe(false);
    const blocked = {
      ...base,
      customerWritesAllowed: false,
      effectiveCapabilities: [],
    };
    expect(
      licensePolicyResponseSchema.safeParse({ ...blocked, state: "invalid" })
        .success,
    ).toBe(true);
    expect(
      licensePolicyResponseSchema.safeParse({
        ...blocked,
        state: "missing",
        expiresAt: null,
        graceEndsAt: null,
      }).success,
    ).toBe(true);
    expect(
      licensePolicyResponseSchema.safeParse({
        ...blocked,
        state: "missing",
        expiresAt: null,
      }).success,
    ).toBe(false);
    expect(
      licensePolicyResponseSchema.safeParse({
        ...base,
        expiresAt: null,
        graceEndsAt: null,
      }).success,
    ).toBe(false);
    expect(
      licensePolicyResponseSchema.safeParse({
        ...blocked,
        state: "grace",
        expiresAt: null,
        graceEndsAt: null,
      }).success,
    ).toBe(false);
    expect(
      licensePolicyResponseSchema.safeParse({
        ...blocked,
        state: "expired_read_only",
        expiresAt: null,
        graceEndsAt: null,
      }).success,
    ).toBe(false);
    expect(
      licensePolicyResponseSchema.safeParse({
        ...base,
        evidenceExportAllowed: false,
      }).success,
    ).toBe(false);
  });
  it("bounds artifacts", () =>
    expect(
      licenseActivationInputSchema.safeParse({
        artifact: "x".repeat(32769),
        expectedVersion: 0,
        idempotencyKey: claims.licenseId,
      }).success,
    ).toBe(false));
  it("only defaults owner/admin licensing and honors revocation", () => {
    expect(defaultPermissionsFor("owner").can_manage_licensing).toBe(true);
    expect(defaultPermissionsFor("admin").can_view_licensing).toBe(true);
    expect(defaultPermissionsFor("member").can_view_licensing).not.toBe(true);
    expect(defaultPermissionsFor("viewer").can_manage_licensing).not.toBe(true);
    expect(
      resolveEffectivePermissions({
        baseRole: "owner",
        baseRoleOverrides: { can_manage_licensing: false },
      }).can_manage_licensing,
    ).toBe(false);
  });
});
