import { describe, expect, it } from "vitest";
import * as schemas from "./operator-registry.schema.js";
const id = "22222222-2222-4222-8222-222222222222";

describe("operator metadata boundary", () => {
  it("defaults missing observations to unknown and scoped counts to null", () => {
    expect(
      schemas.operatorInstanceSummarySchema.parse({
        instanceId: id,
        label: "Local",
      }),
    ).toMatchObject({
      status: "unknown",
      tenantCount: null,
      version: null,
      expectedVersion: null,
      versionDrift: "unknown",
      countScope: "authorized_tenants",
      licenceSummary: {
        active: null,
        grace: null,
        expiredReadOnly: null,
        invalid: null,
        missing: null,
        unknown: null,
      },
    });
  });
  it("defines safe detail and source publication boundaries", () => {
    expect(schemas.operatorInstanceResponseSchema).toBeDefined();
    expect(schemas.operatorInstanceMetadataResponseSchema).toBeDefined();
    expect(schemas.operatorRegistryPublicationSchema).toBeDefined();
  });
  it("rejects all-instance count claims", () => {
    expect(
      schemas.operatorInstanceSummarySchema.safeParse({
        instanceId: id,
        label: "Local",
        countScope: "all_tenants",
      }).success,
    ).toBe(false);
  });
});

const time = "2026-10-14T10:00:00.000Z";
const instance = { instanceId: id, label: "Local" };
const page = {
  schemaVersion: 1,
  instanceId: id,
  revision: 1,
  sourceAt: time,
  observedAt: time,
  instance,
  tenants: [],
  nextCursor: null,
};

describe("operator detailed metadata allowlist", () => {
  it("rejects drift claims without an expected and observed release", () => {
    expect(
      schemas.operatorInstanceSummarySchema.safeParse({
        ...instance,
        versionDrift: "matched",
      }).success,
    ).toBe(false);
  });
  it("rejects contradictory version drift", () => {
    expect(
      schemas.operatorInstanceSummarySchema.safeParse({
        ...instance,
        version: "1",
        expectedVersion: "2",
        versionSourceAt: time,
        versionDrift: "matched",
      }).success,
    ).toBe(false);
  });
  it("rejects duplicate source tenant identities", () => {
    expect(
      schemas.operatorInstanceMetadataResponseSchema.safeParse({
        ...page,
        tenants: [
          { tenantId: id, label: "Tenant" },
          { tenantId: id, label: "Tenant" },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("operator pagination and source provenance", () => {
  it("accepts safe unknown detail and publication pages", () => {
    expect(
      schemas.operatorInstanceResponseSchema.parse({
        schemaVersion: 1,
        observedAt: time,
        instance,
      }).instance.status,
    ).toBe("unknown");
    expect(
      schemas.operatorRegistryPublicationSchema.safeParse({
        metadata: page,
        digest: "a".repeat(64),
      }).success,
    ).toBe(true);
    expect(
      schemas.operatorRegistryPublicationSchema.safeParse({
        metadata: page,
        digest: "token",
      }).success,
    ).toBe(false);
  });
  it("rejects mismatched instance bindings and private details at every level", () => {
    expect(
      schemas.operatorInstanceMetadataResponseSchema.safeParse({
        ...page,
        instanceId: "33333333-3333-4333-8333-333333333333",
      }).success,
    ).toBe(false);
    expect(
      schemas.operatorInstanceMetadataResponseSchema.safeParse({
        ...page,
        hostname: "private",
      }).success,
    ).toBe(false);
    expect(
      schemas.operatorInstanceMetadataResponseSchema.safeParse({
        ...page,
        instance: { ...instance, signingKey: "private" },
      }).success,
    ).toBe(false);
    expect(
      schemas.operatorInstanceMetadataResponseSchema.safeParse({
        ...page,
        tenants: [{ tenantId: id, label: "Tenant", evidence: [] }],
      }).success,
    ).toBe(false);
  });
  it("caps source pages at 100 records", () => {
    const tenants = Array.from({ length: 101 }, (_, i) => ({
      tenantId: `22222222-2222-4222-8222-${String(i).padStart(12, "0")}`,
      label: "Tenant",
    }));
    expect(
      schemas.operatorInstanceMetadataResponseSchema.safeParse({
        ...page,
        tenants,
      }).success,
    ).toBe(false);
    expect(
      schemas.operatorInstanceMetadataResponseSchema.safeParse({
        ...page,
        tenants: tenants.slice(0, 100),
      }).success,
    ).toBe(true);
  });
  it.each(["0", "101", "1.5", "-1", "NaN", [], null])(
    "rejects malformed page limit %s",
    (limit) => {
      expect(
        schemas.operatorInstancesQuerySchema.safeParse({ limit }).success,
      ).toBe(false);
    },
  );
  it("defaults and parses keyset query inputs without accepting extra scope", () => {
    expect(schemas.operatorInstancesQuerySchema.parse({}).limit).toBe(50);
    expect(
      schemas.operatorInstancesQuerySchema.parse({ limit: 25 }).limit,
    ).toBe(25);
    expect(
      schemas.operatorTenantsQuerySchema.parse({
        limit: "1",
        cursor: "safe_cursor",
      }).limit,
    ).toBe(1);
    expect(schemas.operatorInstanceMetadataQuerySchema.parse({}).limit).toBe(
      50,
    );
    expect(
      schemas.operatorEmptyQuerySchema.safeParse({ tenantId: id }).success,
    ).toBe(false);
    expect(
      schemas.operatorInstanceParamsSchema.safeParse({ instanceId: id })
        .success,
    ).toBe(true);
  });
  it("keeps expiry and grace metadata safe and nullable", () => {
    expect(
      schemas.operatorTenantSummarySchema.parse({
        tenantId: id,
        label: "Tenant",
      }).licenceExpiresAt,
    ).toBe(null);
    expect(
      schemas.operatorTenantSummarySchema.safeParse({
        tenantId: id,
        label: "Tenant",
        licenceState: "grace",
        licenceExpiresAt: time,
        graceEndsAt: time,
      }).success,
    ).toBe(true);
  });
  it("requires source timestamps to substantiate healthy observations", () => {
    const source = {
      source: "local",
      status: "healthy",
      sourceAt: time,
      observedAt: time,
      attemptedAt: time,
      succeededAt: time,
      receivedAt: time,
      reasons: [],
    };
    expect(
      schemas.operatorSourceObservationSchema.safeParse(source).success,
    ).toBe(true);
    for (const field of [
      "sourceAt",
      "observedAt",
      "attemptedAt",
      "succeededAt",
      "receivedAt",
    ]) {
      expect(
        schemas.operatorSourceObservationSchema.safeParse({
          ...source,
          [field]: null,
        }).success,
      ).toBe(false);
    }
    expect(
      schemas.operatorSourceObservationSchema.safeParse({
        ...source,
        reasons: ["source_unavailable"],
      }).success,
    ).toBe(false);
    expect(
      schemas.operatorSourceObservationSchema.parse({ source: "local" }).status,
    ).toBe("unknown");
  });
  it.each(["matched", "different"])(
    "accepts substantiated %s version observations",
    (versionDrift) => {
      expect(
        schemas.operatorInstanceSummarySchema.safeParse({
          ...instance,
          version: "1",
          expectedVersion: versionDrift === "matched" ? "1" : "2",
          versionSourceAt: time,
          versionDrift,
        }).success,
      ).toBe(true);
      expect(
        schemas.operatorInstanceSummarySchema.safeParse({
          ...instance,
          version: "1",
          expectedVersion: "1",
          versionSourceAt: null,
          versionDrift,
        }).success,
      ).toBe(false);
    },
  );
});

describe("backup assurance authority", () => {
  it("does not accept operator backup health before M15-05 exists", () => {
    expect(
      schemas.operatorSourceObservationSchema.safeParse({
        source: "backups",
        status: "healthy",
        sourceAt: time,
        observedAt: time,
        attemptedAt: time,
        succeededAt: time,
        receivedAt: time,
        reasons: [],
      }).success,
    ).toBe(false);
    expect(
      schemas.operatorSourceObservationSchema.safeParse({
        source: "backups",
        status: "unknown",
        reasons: ["m15_05_not_available"],
      }).success,
    ).toBe(true);
    expect(
      schemas.operatorSourceObservationSchema.safeParse({ source: "backups" })
        .success,
    ).toBe(false);
  });
});
