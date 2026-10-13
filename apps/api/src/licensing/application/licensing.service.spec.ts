import { LicensingService } from "./licensing.service";
import { LicenseVerificationError } from "../domain/license-errors";
import type { LicenseClaims } from "@repo/contracts/licensing/types";
const org = "22222222-2222-4222-8222-222222222222";
const instance = "33333333-3333-4333-8333-333333333333";
const claims: LicenseClaims = {
  schemaVersion: 1,
  licenseId: "11111111-1111-4111-8111-111111111111",
  sequence: 1,
  issuer: "cra",
  organizationId: org,
  instanceId: instance,
  issuedAt: "2026-01-01T00:00:00.000Z",
  startsAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-10-14T00:00:00.000Z",
  graceDays: 30,
  entitlements: ["products"],
  limits: { activeMembers: 5, products: null, storageBytes: 1000 },
};
const stored = {
  state: {
    organization_id: org,
    artifact: "a.b.c",
    artifact_digest: "a".repeat(64),
    verified_claims: claims,
    issuance_sequence: 1,
    version: 1,
    time_high_water_at: null,
    protected_regulatory_cutoff: null,
  },
  usage: {
    activeMembers: 2,
    reservedInvitations: 1,
    products: 2,
    storageBytes: 10,
    storageReservedBytes: 0,
    protectedStorageBytes: 0,
  },
  storageAccountingReady: true,
};
function fixture() {
  const port = {
    activationReceipt: jest.fn().mockResolvedValue({ outcome: "absent" }),
    listWorkerCandidateOrganizations: jest.fn().mockResolvedValue([org]),
    publishVerification: jest.fn().mockResolvedValue({ outcome: "updated" }),
    getWorkerState: jest.fn().mockResolvedValue(structuredClone(stored)),
    checkpointWorker: jest.fn().mockResolvedValue({
      timeHighWaterAt: null,
      clockRollbackDetected: false,
    }),
    getState: jest.fn().mockResolvedValue(structuredClone(stored)),
    activate: jest.fn().mockResolvedValue({
      outcome: "activated",
      version: 2,
      licenseId: claims.licenseId,
    }),
    history: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    checkpoint: jest.fn().mockResolvedValue({
      timeHighWaterAt: null,
      clockRollbackDetected: false,
    }),
    archive: jest.fn().mockResolvedValue("org/digest"),
  };
  const verifier = {
    trustDigest: "c".repeat(64),
    verify: jest
      .fn()
      .mockResolvedValue({ claims, digest: "a".repeat(64), keyId: "key" }),
  };
  const service = new LicensingService(
    port,
    () => Promise.resolve(verifier),
    { instanceId: instance, configuration: {} },
    () => new Date("2026-10-13T00:00:00.000Z"),
    () => 0,
  );
  return { service, port, verifier };
}
describe("LicensingService", () => {
  it("reverifies stored artifacts and persists trusted time without trusting claim projection", async () => {
    const { service, port, verifier } = fixture();
    const current = await service.getCurrent(org, "actor");
    expect(current.policy.state).toBe("active");
    expect(current.usage.activeMembers).toBe(3);
    expect(verifier.verify).toHaveBeenCalledWith(
      "a.b.c",
      { organizationId: org, instanceId: instance },
      expect.any(Date),
      { activation: false },
    );
    expect(port.checkpoint).toHaveBeenCalled();
  });
  it("retains expired evidence access and existing customer reads but denies new writes", async () => {
    const { service, port, verifier } = fixture();
    const expired = { ...claims, expiresAt: "2026-08-01T00:00:00.000Z" };
    verifier.verify.mockResolvedValue({
      claims: expired,
      digest: "a".repeat(64),
      keyId: "key",
    });
    port.getState.mockResolvedValue({
      ...stored,
      state: { ...stored.state, verified_claims: expired },
    });
    await expect(
      service.assertOperation(org, "actor", { kind: "evidence" }),
    ).resolves.toBeUndefined();
    await expect(
      service.assertOperation(org, "actor", {
        kind: "customer",
        capability: "products",
        mutation: false,
      }),
    ).resolves.toBeUndefined();
    await expect(
      service.assertOperation(org, "actor", {
        kind: "customer",
        capability: "products",
        mutation: true,
      }),
    ).rejects.toMatchObject({ code: "license_read_only" });
  });
  it("audits rejected replacement without replacing active licence", async () => {
    const { service, port, verifier } = fixture();
    verifier.verify.mockRejectedValue(
      new LicenseVerificationError("unknown_key"),
    );
    port.activate.mockResolvedValue({ outcome: "rejected", version: 1 });
    await expect(
      service.activate(org, "actor", {
        artifact: "a.b.c",
        expectedVersion: 1,
        idempotencyKey: claims.licenseId,
      }),
    ).rejects.toMatchObject({ code: "license_invalid_artifact" });
    expect(port.activate).toHaveBeenCalledWith(
      org,
      "actor",
      expect.objectContaining({ claims: null, rejectionReason: "unknown_key" }),
    );
    expect(port.archive).not.toHaveBeenCalled();
  });
  it("reports optimistic conflict and never exposes artifact", async () => {
    const { service, port } = fixture();
    port.activate.mockResolvedValue({ outcome: "conflict", version: 2 });
    await expect(
      service.activate(org, "actor", {
        artifact: "a.b.c",
        expectedVersion: 1,
        idempotencyKey: claims.licenseId,
      }),
    ).rejects.toMatchObject({ code: "license_conflict" });
  });
  it("does not swallow failure to audit rejected replacement", async () => {
    const { service, port, verifier } = fixture();
    verifier.verify.mockRejectedValue(
      new LicenseVerificationError("unknown_key"),
    );
    port.activate.mockRejectedValue(new Error("audit unavailable"));
    await expect(
      service.activate(org, "actor", {
        artifact: "a.b.c",
        expectedVersion: 1,
        idempotencyKey: claims.licenseId,
      }),
    ).rejects.toThrow("audit unavailable");
  });

  it("worker checks never send an empty actor to member authority", async () => {
    const { service, port } = fixture();
    await expect(service.canClaim(org, "products")).resolves.toBe(true);
    expect(port.getWorkerState).toHaveBeenCalledWith(org);
    expect(port.getState).not.toHaveBeenCalled();
    expect(port.checkpointWorker).toHaveBeenCalled();
  });
  it("preserves verified reads when a downgrade removes a capability", async () => {
    const { service } = fixture();
    await expect(
      service.assertOperation(org, "actor", {
        kind: "customer",
        capability: "sboms",
        mutation: false,
      }),
    ).resolves.toBeUndefined();
    await expect(
      service.assertOperation(org, "actor", {
        kind: "customer",
        capability: "sboms",
        mutation: true,
      }),
    ).rejects.toMatchObject({ code: "license_capability_disabled" });
  });

  it("blocks unlicensed capability and preserves safe operations without provisioning", async () => {
    const { service } = fixture();
    await expect(
      service.assertOperation(org, "actor", {
        kind: "customer",
        capability: "ai",
      }),
    ).rejects.toMatchObject({ code: "license_capability_disabled" });
    for (const kind of ["security", "protective", "renewal"] as const)
      await expect(
        service.assertOperation(org, "actor", { kind }),
      ).resolves.toBeUndefined();
  });
  it("reports prior artifact mismatch separately and includes rejected attempt", async () => {
    const { service, port } = fixture();
    port.getState.mockResolvedValue({
      ...stored,
      state: { ...stored.state, artifact_digest: "b".repeat(64) },
      lastRejected: {
        reason: "unknown_key",
        occurredAt: "2026-10-12T00:00:00.000Z",
      },
    });
    const current = await service.getCurrent(org, "actor");
    expect(current.policy.reasons).toContain("stored_artifact_mismatch");
    expect(current.lastRejected?.reason).toBe("unknown_key");
  });
  it("supports current missing state and history parsing", async () => {
    const { service, port } = fixture();
    port.getState.mockResolvedValue({ ...stored, state: null });
    await expect(service.getPolicy(org, "actor")).resolves.toMatchObject({
      state: "missing",
    });
    await expect(
      service.getHistory(org, "actor", { limit: 20 }),
    ).resolves.toEqual({ items: [], nextCursor: null });
  });
  it("does not preserve customer reads without a trusted licence state", async () => {
    const { service, port } = fixture();
    port.getState.mockResolvedValue({ ...stored, state: null });
    await expect(
      service.assertOperation(org, "actor", {
        kind: "customer",
        capability: "products",
        mutation: false,
      }),
    ).rejects.toMatchObject({ code: "license_capability_disabled" });
  });

  it("reports valid activation receipt and replay", async () => {
    const { service, port } = fixture();
    const input = {
      artifact: "a.b.c",
      expectedVersion: 1,
      idempotencyKey: claims.licenseId,
    };
    await expect(service.activate(org, "actor", input)).resolves.toMatchObject({
      version: 2,
      replayed: false,
    });
    port.activate.mockResolvedValue({
      outcome: "replayed",
      version: 2,
      licenseId: claims.licenseId,
    });
    await expect(service.activate(org, "actor", input)).resolves.toMatchObject({
      replayed: true,
    });
    port.activate.mockResolvedValue({ outcome: "forbidden", version: 1 });
    await expect(service.activate(org, "actor", input)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
  it.each(["beyond_grace", "unknown_key", "clock_untrusted"])(
    "replays original durable receipt despite current %s without reactivation",
    async (reason) => {
      const { service, port, verifier } = fixture();
      const originalId = "44444444-4444-4444-8444-444444444444";
      const receipt = jest.fn().mockResolvedValue({
        outcome: "replayed",
        version: 2,
        licenseId: originalId,
      });
      Object.assign(port, { activationReceipt: receipt });
      verifier.verify.mockRejectedValue(new LicenseVerificationError(reason));
      await expect(
        service.activate(org, "actor", {
          artifact: "a.b.c",
          expectedVersion: 1,
          idempotencyKey: claims.licenseId,
        }),
      ).resolves.toMatchObject({
        licenseId: originalId,
        version: 2,
        replayed: true,
      });
      expect(receipt).toHaveBeenCalledWith(
        org,
        "actor",
        expect.objectContaining({
          artifact: "a.b.c",
          idempotencyKey: claims.licenseId,
          requestDigest: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown,
        }),
      );
      expect(port.activate).not.toHaveBeenCalled();
      expect(port.getState).not.toHaveBeenCalled();
      expect(verifier.verify).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["conflict", "license_conflict"],
    ["forbidden", "forbidden"],
  ])("rejects %s receipt lookup before verification", async (outcome, code) => {
    const { service, port, verifier } = fixture();
    Object.assign(port, {
      activationReceipt: jest.fn().mockResolvedValue({ outcome, version: 2 }),
    });
    await expect(
      service.activate(org, "actor", {
        artifact: "changed.input",
        expectedVersion: 1,
        idempotencyKey: claims.licenseId,
      }),
    ).rejects.toMatchObject({ code });
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(port.activate).not.toHaveBeenCalled();
  });
  it("returns the recorded rejection reason on an identical rejected retry", async () => {
    const { service, port } = fixture();
    Object.assign(port, {
      activationReceipt: jest.fn().mockResolvedValue({
        outcome: "rejected",
        version: 1,
        reason: "wrong_instance",
      }),
    });
    await expect(
      service.activate(org, "actor", {
        artifact: "a.b.c",
        expectedVersion: 1,
        idempotencyKey: claims.licenseId,
      }),
    ).rejects.toMatchObject({
      code: "license_invalid_artifact",
      reason: "wrong_instance",
    });
    expect(port.activate).not.toHaveBeenCalled();
  });
  it("returns a concurrent winner receipt even if local activation verification now fails", async () => {
    const { service, port, verifier } = fixture();
    verifier.verify.mockRejectedValue(
      new LicenseVerificationError("beyond_grace"),
    );
    port.activate.mockResolvedValue({
      outcome: "replayed",
      version: 2,
      licenseId: claims.licenseId,
    });
    await expect(
      service.activate(org, "actor", {
        artifact: "a.b.c",
        expectedVersion: 1,
        idempotencyKey: claims.licenseId,
      }),
    ).resolves.toMatchObject({ replayed: true, licenseId: claims.licenseId });
    expect(port.activate).toHaveBeenCalledWith(
      org,
      "actor",
      expect.objectContaining({ claims: null }),
    );
  });
  it("clock rollback blocks activation and customer use", async () => {
    const { service, port } = fixture();
    port.checkpoint.mockResolvedValue({
      timeHighWaterAt: "2026-10-14T00:00:00.000Z",
      clockRollbackDetected: true,
    });
    port.activate.mockResolvedValue({ outcome: "rejected", version: 1 });
    await expect(
      service.activate(org, "actor", {
        artifact: "a.b.c",
        expectedVersion: 1,
        idempotencyKey: claims.licenseId,
      }),
    ).rejects.toMatchObject({ reason: "clock_untrusted" });
  });

  it("prepares bounded due organizations and exposes worker policy", async () => {
    const { service, port } = fixture();
    await service.prepareClaims("products");
    expect(port.listWorkerCandidateOrganizations).toHaveBeenCalledWith(
      "products",
      100,
      1,
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(port.publishVerification).toHaveBeenCalledWith(
      org,
      null,
      expect.objectContaining({
        verified: true,
        capabilities: ["products"],
        policyRevision: 1,
      }),
    );
    await expect(service.getWorkerPolicy(org)).resolves.toMatchObject({
      state: "active",
    });
  });
  it("rejects stale policy proof and trust conflicts", async () => {
    const { service, port } = fixture();
    for (const outcome of ["stale", "conflict"]) {
      port.publishVerification.mockResolvedValue({ outcome });
      await expect(service.getCurrent(org, "actor")).rejects.toMatchObject({
        code: "license_conflict",
      });
    }
    port.publishVerification.mockResolvedValue({ outcome: "forbidden" });
    await expect(service.getCurrent(org, "actor")).rejects.toMatchObject({
      code: "forbidden",
    });
  });
  it("does not turn unavailable trust into an allowed worker claim", async () => {
    const { service, verifier } = fixture();
    verifier.verify.mockRejectedValue(new Error("filesystem unavailable"));
    await expect(service.canClaim(org, "products")).rejects.toMatchObject({
      code: "unavailable",
    });
  });
  it("missing instance prevents licensed access and leaves safe bypasses available", async () => {
    const { port, verifier } = fixture();
    const service = new LicensingService(
      port,
      () => Promise.resolve(verifier),
      {
        configuration: {},
      },
    );
    await expect(service.getPolicy(org, "actor")).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(
      service.assertOperation(org, "actor", { kind: "evidence" }),
    ).resolves.toBeUndefined();
  });
});
