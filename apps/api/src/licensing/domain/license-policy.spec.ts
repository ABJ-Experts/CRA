import { calculateTrustedTime, evaluateLicensePolicy } from "./license-policy";
import type { LicenseClaims } from "@repo/contracts/licensing";
export const claims: LicenseClaims = {
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
  entitlements: ["products", "evidence"],
  limits: { activeMembers: 5, products: null, storageBytes: 1000 },
};
describe("offline licence policy", () => {
  it.each([
    ["2026-01-31T23:59:59.999Z", "active", true],
    ["2026-02-01T00:00:00Z", "grace", true],
    ["2026-03-03T00:00:00Z", "expired_read_only", false],
  ] as const)("evaluates boundary %s", (at, state, writable) => {
    const policy = evaluateLicensePolicy({ claims, now: new Date(at) });
    expect(policy.state).toBe(state);
    expect(policy.customerWritesAllowed).toBe(writable);
    expect(policy.evidenceExportAllowed).toBe(true);
  });
  it("configuration cannot grant capabilities and disabled grants are explicit", () => {
    const policy = evaluateLicensePolicy({
      claims,
      now: new Date(claims.startsAt),
      configuration: { products: false, ai: true },
    });
    expect(policy.effectiveCapabilities).toEqual(["evidence"]);
    expect(policy.disabledCapabilities).toEqual(["products"]);
  });
  it.each([
    [null, undefined, true, "missing"],
    [claims, "invalid_signature", true, "invalid"],
    [claims, undefined, false, "clock_untrusted"],
  ] as const)(
    "fails closed while retaining export",
    (value, invalidReason, clockTrusted, state) => {
      const policy = evaluateLicensePolicy({
        claims: value,
        now: new Date(claims.startsAt),
        invalidReason,
        clockTrusted,
      });
      expect(policy.state).toBe(state);
      expect(policy.customerWritesAllowed).toBe(false);
      expect(policy.evidenceExportAllowed).toBe(true);
    },
  );
  it("warns within thirty days and at eighty percent with reservations", () =>
    expect(
      evaluateLicensePolicy({
        claims,
        now: new Date("2026-01-03T00:00:00Z"),
        usage: {
          activeMembers: 4,
          products: 100,
          storageBytes: 700,
          storageReservedBytes: 100,
          protectedStorageBytes: 9999,
          availability: "ready",
        },
      }).warnings,
    ).toEqual([
      "approaching_expiry",
      "approaching_activeMembers_limit",
      "approaching_storageBytes_limit",
    ]));
  it("rejects nonfinite clock inputs", () => {
    expect(() =>
      calculateTrustedTime({
        wallTimeMs: NaN,
        persistedHighWaterMs: 0,
        processStartedWallMs: 0,
        monotonicElapsedMs: 0,
      }),
    ).toThrow();
    expect(() =>
      evaluateLicensePolicy({ claims, now: new Date("invalid") }),
    ).toThrow();
  });
  it("reports unavailable and exceeded caps without granting writes", () => {
    const usage = {
      activeMembers: 5,
      products: 100,
      storageBytes: 1000,
      storageReservedBytes: 5,
      protectedStorageBytes: 0,
      availability: "ready" as const,
    };
    expect(
      evaluateLicensePolicy({ claims, now: new Date(claims.startsAt), usage })
        .warnings,
    ).toEqual(["at_activeMembers_limit", "at_storageBytes_limit"]);
    expect(
      evaluateLicensePolicy({
        claims,
        now: new Date(claims.startsAt),
        usage: { ...usage, availability: "unavailable" },
      }).warnings,
    ).toEqual(["usage_unavailable"]);
    expect(
      evaluateLicensePolicy({
        claims: {
          ...claims,
          limits: { activeMembers: 0, products: 0, storageBytes: 0 },
        },
        now: new Date(claims.startsAt),
        usage,
      }).warnings,
    ).toHaveLength(3);
    expect(
      evaluateLicensePolicy({ claims, now: new Date("2025-01-01T00:00:00Z") })
        .reasons,
    ).toEqual(["not_yet_active"]);
  });
  it("never rewinds persisted or process monotonic time", () => {
    expect(
      calculateTrustedTime({
        wallTimeMs: 0,
        persistedHighWaterMs: 600001,
        processStartedWallMs: 500000,
        monotonicElapsedMs: 150000,
      }),
    ).toEqual({
      effectiveTimeMs: 650000,
      highWaterMs: 650000,
      clockTrusted: false,
    });
    expect(
      calculateTrustedTime({
        wallTimeMs: 1000000,
        persistedHighWaterMs: 0,
        processStartedWallMs: 0,
        monotonicElapsedMs: 0,
      }).clockTrusted,
    ).toBe(true);
  });
});
