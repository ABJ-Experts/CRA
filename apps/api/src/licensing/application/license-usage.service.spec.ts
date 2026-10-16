import type { LicenseCurrentResponse } from "@repo/contracts/licensing/types";
import { LicenseUsageService } from "./license-usage.service";
import type { UsageCommand, UsageOperation } from "./license-usage.port";
import { LicensingError } from "./licensing.errors";

const org = "00000000-0000-4000-8000-000000000001";
const audit = "00000000-0000-4000-8000-000000000002";
const input = {
  expectedLicenseVersion: 2,
  expectedMeterVersion: 3,
  idempotencyKey: "00000000-0000-4000-8000-000000000003",
};
const projection = {
  outcome: "ready" as const,
  organizationId: org,
  observedAt: "2026-10-13T10:00:00.000Z",
  licenseVersion: 2,
  policyRevision: 1,
  issuanceSequence: 2,
  meterVersion: 3,
  reconciledAt: null,
  components: {
    activeMembers: 2,
    reservedInvitations: 1,
    products: 3,
    storageBytes: 4,
    storageReservedBytes: 5,
    protectedStorageBytes: 6,
  },
  availability: {
    seats: "ready" as const,
    products: "ready" as const,
    storage: "ready" as const,
    protected_storage: "ready" as const,
  },
  reasons: { seats: [], products: [], storage: [], protected_storage: [] },
};
const current: LicenseCurrentResponse = {
  instanceId: org,
  digest: null,
  keyId: null,
  lastRejected: null,
  usage: {
    activeMembers: 3,
    products: 3,
    storageBytes: 4,
    storageReservedBytes: 5,
    protectedStorageBytes: 6,
    availability: "ready",
  },
  version: 2,
  claims: {
    schemaVersion: 1,
    licenseId: audit,
    sequence: 2,
    issuer: "local",
    organizationId: org,
    instanceId: org,
    issuedAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-11-01T00:00:00.000Z",
    graceDays: 30,
    entitlements: ["products"],
    startsAt: "2026-10-01T00:00:00.000Z",
    limits: { activeMembers: 4, products: null, storageBytes: 100 },
  },
  policy: {
    state: "active",
    warnings: [],
    disabledCapabilities: [],
    customerWritesAllowed: true,
    evidenceExportAllowed: true,
    evaluatedAt: projection.observedAt,
    reasons: [],
    expiresAt: "2026-11-01T00:00:00.000Z",
    graceEndsAt: "2026-12-01T00:00:00.000Z",
    effectiveCapabilities: ["products"],
  },
};
const reconciliation = {
  auditEventId: audit,
  meterVersion: 4,
  checked: 100,
  repaired: 2,
  released: 3,
  unresolved: 1,
  completedAt: projection.observedAt,
  replayed: false,
};
function setup(configured = true) {
  const port = {
    read: jest.fn().mockResolvedValue(projection),
    receipt: jest.fn().mockResolvedValue({ outcome: "absent" }),
    export: jest.fn(),
    reconcile: jest
      .fn()
      .mockResolvedValue({ outcome: "reconciled", ...reconciliation }),
  };
  const context = {
    getCurrent: jest.fn().mockResolvedValue(current),
    instanceConfigured: configured,
    policyRevision: 1,
  };
  return { port, context, service: new LicenseUsageService(port, context) };
}
describe("LicenseUsageService", () => {
  it("reads authorized usage with unverified limits when instance identity is missing", async () => {
    const { service, port, context } = setup(false);
    const result = await service.getUsage(org, "actor");
    expect(port.read).toHaveBeenCalledWith(org, "actor", null);
    expect(context.getCurrent).not.toHaveBeenCalled();
    expect(result.license).toMatchObject({
      verified: false,
      state: null,
      reasons: ["instance_not_configured"],
    });
    expect(result.counters[0]!.limit.kind).toBe("unverified");
  });
  it("pairs verified limits with a fresh matching licence/meter version and aggregate facts only", async () => {
    const { service, port } = setup();
    const result = await service.getUsage(org, "actor");
    expect(port.read).toHaveBeenCalledWith(org, "actor", 2);
    expect(result.license).toMatchObject({
      verified: true,
      issuanceSequence: 2,
      effectiveCapabilities: ["products"],
    });
    expect(result.counters.map((row) => row.value)).toEqual([3, 3, 9, 6]);
    expect(JSON.stringify(result)).not.toMatch(
      /"(?:artifact|email|keyId|digest)":/,
    );
  });
  it.each(["missing", "invalid", "clock_untrusted"])(
    "does not grant verified limits for %s context",
    async (state) => {
      const { service, context } = setup();
      context.getCurrent.mockResolvedValue({
        ...current,
        policy: { ...current.policy, state },
        claims: state === "missing" ? null : current.claims,
      });
      const result = await service.getUsage(org, "actor");
      expect(result.license.verified).toBe(false);
      expect(result.counters[1]!.limit.kind).toBe("unverified");
    },
  );
  it("preserves verified limits for expired evidence diagnostics", async () => {
    const { service, context } = setup();
    context.getCurrent.mockResolvedValue({
      ...current,
      policy: {
        ...current.policy,
        state: "expired_read_only",
        evaluatedAt: "2026-12-01T00:00:00.000Z",
        effectiveCapabilities: [],
      },
    });
    expect((await service.getUsage(org, "actor")).license.verified).toBe(true);
  });
  it.each(["forbidden", "conflict"])(
    "rejects %s projection",
    async (outcome) => {
      const { service, port } = setup();
      port.read.mockResolvedValue({ outcome });
      await expect(service.getUsage(org, "actor")).rejects.toMatchObject({
        status: outcome === "forbidden" ? 403 : 409,
      });
    },
  );
  it.each([
    { ...projection, organizationId: audit },
    { ...projection, licenseVersion: 3 },
    { ...projection, issuanceSequence: 3 },
  ])("rejects mismatched tenant/version", async (value) => {
    const { service, port } = setup();
    port.read.mockResolvedValue(value);
    await expect(service.getUsage(org, "actor")).rejects.toMatchObject({
      code: "license_usage_conflict",
    });
  });
  it("does not mask a licence database outage as unverified limits", async () => {
    const { service, context, port } = setup();
    context.getCurrent.mockRejectedValue(
      new LicensingError("unavailable", 503, "Unavailable"),
    );
    await expect(service.getUsage(org, "actor")).rejects.toMatchObject({
      status: 503,
    });
    expect(port.read).not.toHaveBeenCalled();
  });
  it("exports a coherent snapshot and binds digest to versions and operation", async () => {
    const { service, port } = setup();
    const snapshot = await service.getUsage(org, "actor");
    port.export.mockResolvedValue({
      outcome: "exported",
      snapshot,
      auditEventId: audit,
      replayed: false,
    });
    expect(await service.exportUsage(org, "actor", input)).toEqual({
      snapshot,
      auditEventId: audit,
      replayed: false,
    });
    const calls = port.receipt.mock.calls as unknown as Array<
      [string, string, UsageOperation, UsageCommand]
    >;
    const command = calls[0]![3];
    expect(port.export).toHaveBeenCalledWith(org, "actor", command, snapshot);
    await service.reconcileUsage(org, "actor", input);
    expect(calls[1]![3].requestDigest).not.toBe(command.requestDigest);
    await service.reconcileUsage(org, "actor", input);
    expect(calls[2]![3].requestDigest).toBe(calls[1]![3].requestDigest);
  });
  it.each(["forbidden", "conflict"])(
    "rejects %s receipt before reading context",
    async (outcome) => {
      const { service, port, context } = setup();
      port.receipt.mockResolvedValue({ outcome });
      await expect(
        service.exportUsage(org, "actor", input),
      ).rejects.toMatchObject({ status: outcome === "forbidden" ? 403 : 409 });
      await expect(
        service.reconcileUsage(org, "actor", input),
      ).rejects.toMatchObject({ status: outcome === "forbidden" ? 403 : 409 });
      expect(context.getCurrent).not.toHaveBeenCalled();
    },
  );
  it("replays the original export before fresh context after licence replacement", async () => {
    const { service, port, context } = setup();
    const snapshot = await service.getUsage(org, "actor");
    context.getCurrent.mockClear();
    port.receipt.mockResolvedValue({
      outcome: "replayed",
      receipt: {
        outcome: "exported",
        snapshot,
        auditEventId: audit,
        replayed: false,
      },
    });
    expect(await service.exportUsage(org, "actor", input)).toEqual({
      snapshot,
      auditEventId: audit,
      replayed: true,
    });
    expect(context.getCurrent).not.toHaveBeenCalled();
    expect(port.export).not.toHaveBeenCalled();
  });
  it.each([
    { ...input, expectedLicenseVersion: 1 },
    { ...input, expectedMeterVersion: 1 },
  ])("rejects stale export input", async (value) => {
    const { service, port } = setup();
    await expect(
      service.exportUsage(org, "actor", value),
    ).rejects.toMatchObject({ status: 409 });
    expect(port.export).not.toHaveBeenCalled();
  });
  it.each(["forbidden", "conflict", "busy"])(
    "maps transaction %s outcomes on export and reconciliation",
    async (outcome) => {
      const { service, port } = setup();
      port.export.mockResolvedValue({ outcome });
      port.reconcile.mockResolvedValue({ outcome });
      await expect(
        service.exportUsage(org, "actor", input),
      ).rejects.toMatchObject({ status: outcome === "forbidden" ? 403 : 409 });
      await expect(
        service.reconcileUsage(org, "actor", input),
      ).rejects.toMatchObject({ status: outcome === "forbidden" ? 403 : 409 });
    },
  );
  it("returns an immutable independent reconciliation receipt without reading licence context", async () => {
    const { service, context, port } = setup();
    expect(await service.reconcileUsage(org, "actor", input)).toEqual(
      reconciliation,
    );
    expect(context.getCurrent).not.toHaveBeenCalled();
    port.receipt.mockResolvedValue({
      outcome: "replayed",
      receipt: { outcome: "reconciled", ...reconciliation },
    });
    expect(await service.reconcileUsage(org, "actor", input)).toEqual({
      ...reconciliation,
      replayed: true,
    });
  });

  it.each([
    ["2026-11-01T00:00:00.000Z", "grace", ["products"]],
    ["2026-12-01T00:00:00.000Z", "expired_read_only", []],
  ])(
    "reevaluates signed policy at projection timestamp %s",
    async (observedAt, state, capabilities) => {
      const { service, port } = setup();
      port.read.mockResolvedValue({ ...projection, observedAt });
      const result = await service.getUsage(org, "actor");
      expect(result.license.state).toBe(state);
      expect(result.license.effectiveCapabilities).toEqual(capabilities);
      expect(result.license.reasons).toEqual([state]);
    },
  );
  it("never rewinds a trusted licence evaluation when database wall time is behind", async () => {
    const { service, context } = setup();
    context.getCurrent.mockResolvedValue({
      ...current,
      policy: {
        ...current.policy,
        evaluatedAt: "2026-11-02T00:00:00.000Z",
        state: "grace",
      },
    });
    expect(await service.getUsage(org, "actor")).toMatchObject({
      observedAt: "2026-11-02T00:00:00.000Z",
      license: { state: "grace", verified: true },
    });
  });
  it("preserves locally disabled capabilities when reevaluating an expiry boundary", async () => {
    const { service, context, port } = setup();
    context.getCurrent.mockResolvedValue({
      ...current,
      policy: {
        ...current.policy,
        disabledCapabilities: ["products"],
        effectiveCapabilities: [],
      },
    });
    port.read.mockResolvedValue({
      ...projection,
      observedAt: "2026-11-01T00:00:00.000Z",
    });
    expect((await service.getUsage(org, "actor")).license).toMatchObject({
      state: "grace",
      effectiveCapabilities: [],
    });
  });
  it("does not promote a future-start invalid context when source observation crosses its start", async () => {
    const { service, context, port } = setup();
    context.getCurrent.mockResolvedValue({
      ...current,
      claims: { ...current.claims, startsAt: "2026-10-20T00:00:00.000Z" },
      policy: {
        ...current.policy,
        state: "invalid",
        reasons: ["not_yet_active"],
        effectiveCapabilities: [],
      },
    });
    port.read.mockResolvedValue({
      ...projection,
      observedAt: "2026-10-21T00:00:00.000Z",
    });
    expect((await service.getUsage(org, "actor")).license).toMatchObject({
      state: "invalid",
      verified: false,
      reasons: ["not_yet_active"],
      effectiveCapabilities: [],
    });
  });
  it.each(["organizationId", "licenseVersion", "meterVersion"])(
    "rejects a forged replay %s",
    async (field) => {
      const { service, port, context } = setup();
      const snapshot = await service.getUsage(org, "actor");
      const forged =
        field === "organizationId"
          ? { ...snapshot, organizationId: audit }
          : field === "licenseVersion"
            ? { ...snapshot, license: { ...snapshot.license, version: 1 } }
            : { ...snapshot, meterVersion: 1 };
      port.receipt.mockResolvedValue({
        outcome: "replayed",
        receipt: {
          outcome: "exported",
          snapshot: forged,
          auditEventId: audit,
          replayed: false,
        },
      });
      context.getCurrent.mockClear();
      await expect(
        service.exportUsage(org, "actor", input),
      ).rejects.toMatchObject({ code: "license_usage_conflict", status: 409 });
      expect(context.getCurrent).not.toHaveBeenCalled();
    },
  );
  it.each(["organizationId", "licenseVersion", "meterVersion"])(
    "rejects a forged atomic export %s",
    async (field) => {
      const { service, port } = setup();
      const snapshot = await service.getUsage(org, "actor");
      const forged =
        field === "organizationId"
          ? { ...snapshot, organizationId: audit }
          : field === "licenseVersion"
            ? { ...snapshot, license: { ...snapshot.license, version: 1 } }
            : { ...snapshot, meterVersion: 1 };
      port.export.mockResolvedValue({
        outcome: "exported",
        snapshot: forged,
        auditEventId: audit,
        replayed: false,
      });
      await expect(
        service.exportUsage(org, "actor", input),
      ).rejects.toMatchObject({ code: "license_usage_conflict", status: 409 });
    },
  );

  it("uses the stored licence head revision for unconfigured diagnostics", async () => {
    const { service, port } = setup(false);
    port.read.mockResolvedValue({ ...projection, policyRevision: 0 });
    expect((await service.getUsage(org, "actor")).license).toMatchObject({
      policyRevision: 0,
      verified: false,
    });
  });
  it("uses the stored licence head revision for locally unverified context", async () => {
    const { service, port, context } = setup();
    context.getCurrent.mockResolvedValue({
      ...current,
      policy: {
        ...current.policy,
        state: "invalid",
        reasons: ["trust_unavailable"],
        effectiveCapabilities: [],
      },
      claims: null,
    });
    port.read.mockResolvedValue({ ...projection, policyRevision: 7 });
    expect((await service.getUsage(org, "actor")).license).toMatchObject({
      policyRevision: 7,
      verified: false,
    });
  });
  it("rejects a configured verified proof whose revision differs from the stored head", async () => {
    const { service, port } = setup();
    port.read.mockResolvedValue({ ...projection, policyRevision: 2 });
    await expect(service.getUsage(org, "actor")).rejects.toMatchObject({
      code: "license_usage_conflict",
      status: 409,
    });
  });
  it("uses zero as the unverified revision sentinel when no licence head exists", async () => {
    const { service, port } = setup(false);
    port.read.mockResolvedValue({
      ...projection,
      licenseVersion: 0,
      issuanceSequence: null,
      policyRevision: null,
    });
    expect((await service.getUsage(org, "actor")).license).toMatchObject({
      version: 0,
      issuanceSequence: null,
      policyRevision: 0,
      verified: false,
    });
  });

  it("rejects raw extra fields before any database access", async () => {
    const { service, port } = setup();
    await expect(
      service.exportUsage(org, "actor", {
        ...input,
        organizationId: audit,
      } as typeof input),
    ).rejects.toThrow();
    expect(port.receipt).not.toHaveBeenCalled();
  });
});
