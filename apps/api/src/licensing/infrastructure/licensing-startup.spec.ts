import { LicensingStartup } from "./licensing-startup";
import { SupabaseLicensingRepository } from "./supabase-licensing.repository";
import { LocalLicenseVerifier } from "./local-license-verifier";
import { LicensingService } from "../application/licensing.service";
import type { LicensingPort } from "../application/licensing.port";
import { createHash } from "node:crypto";
import { generateKeyPair, exportJWK, CompactSign } from "jose";
const org = "22222222-2222-4222-8222-222222222222";
const instance = "33333333-3333-4333-8333-333333333333";
function fixture() {
  const repository = {
    listPolicyTenants: jest
      .fn()
      .mockResolvedValue({ organizationIds: [org], nextCursor: null }),
  };
  const service = {
    getWorkerPolicy: jest.fn().mockResolvedValue({ state: "active" }),
  };
  const trust = jest.fn().mockResolvedValue(undefined);
  const startup = new LicensingStartup(repository, service, trust, {
    instanceId: instance,
    trustFile: "/trust.json",
  });
  return { repository, service, trust, startup };
}
describe("licensing startup barrier", () => {
  it("loads trust before synchronizing every bounded keyset page", async () => {
    const { repository, service, trust, startup } = fixture();
    const second = "44444444-4444-4444-8444-444444444444";
    repository.listPolicyTenants
      .mockResolvedValueOnce({ organizationIds: [org], nextCursor: org })
      .mockResolvedValueOnce({ organizationIds: [second], nextCursor: null });
    await startup.onApplicationBootstrap();
    expect(repository.listPolicyTenants.mock.calls).toEqual([
      [100, null],
      [100, org],
    ]);
    expect(service.getWorkerPolicy.mock.calls).toEqual([[org], [second]]);
    expect(trust.mock.invocationCallOrder[0]).toBeLessThan(
      service.getWorkerPolicy.mock.invocationCallOrder[0] ?? 0,
    );
  });
  it("fails startup on malformed configured trust even with no tenant licence", async () => {
    const { repository, trust, startup } = fixture();
    repository.listPolicyTenants.mockResolvedValue({
      organizationIds: [],
      nextCursor: null,
    });
    trust.mockImplementation(() =>
      Promise.resolve(new LocalLicenseVerifier({ issuer: "cra", keys: [] })),
    );
    await expect(startup.onApplicationBootstrap()).rejects.toThrow();
    expect(repository.listPolicyTenants).not.toHaveBeenCalled();
  });
  it.each([
    { organizationIds: [org, org], nextCursor: org },
    { organizationIds: [org], nextCursor: instance },
    { organizationIds: [], nextCursor: org },
    { organizationIds: ["bad"], nextCursor: null },
  ])(
    "rejects non-progressing or malformed pages before publishing: %j",
    async (page) => {
      const { repository, service, startup } = fixture();
      repository.listPolicyTenants.mockResolvedValue(page);
      await expect(startup.onApplicationBootstrap()).rejects.toThrow();
      expect(repository.listPolicyTenants).toHaveBeenCalledTimes(1);
      expect(service.getWorkerPolicy).not.toHaveBeenCalled();
    },
  );
  it("rejects repeated pages instead of looping indefinitely", async () => {
    const { repository, startup } = fixture();
    repository.listPolicyTenants.mockResolvedValue({
      organizationIds: [org],
      nextCursor: org,
    });
    await expect(startup.onApplicationBootstrap()).rejects.toThrow();
    expect(repository.listPolicyTenants).toHaveBeenCalledTimes(2);
  });
  it("fails closed when durable deployment revision conflicts", async () => {
    const { service, startup } = fixture();
    service.getWorkerPolicy.mockRejectedValue(
      new Error("Licence or trust policy changed"),
    );
    await expect(startup.onApplicationBootstrap()).rejects.toThrow(
      "policy changed",
    );
  });
  it.each([{}, { instanceId: instance }, { trustFile: "/trust.json" }])(
    "allows an empty unprovisioned installation: %j",
    async (config) => {
      const { repository, service, trust } = fixture();
      repository.listPolicyTenants.mockResolvedValue({
        organizationIds: [],
        nextCursor: null,
      });
      await new LicensingStartup(
        repository,
        service,
        trust,
        config,
      ).onApplicationBootstrap();
      expect(trust).toHaveBeenCalledTimes(config.trustFile ? 1 : 0);
      expect(service.getWorkerPolicy).not.toHaveBeenCalled();
    },
  );
  it.each([{}, { instanceId: instance }, { trustFile: "/trust.json" }])(
    "blocks unprovisioned restart with persisted licence states: %j",
    async (config) => {
      const { repository, service, trust } = fixture();
      await expect(
        new LicensingStartup(
          repository,
          service,
          trust,
          config,
        ).onApplicationBootstrap(),
      ).rejects.toThrow("configuration");
      expect(service.getWorkerPolicy).not.toHaveBeenCalled();
    },
  );
  it("re-verifies a stored licence after its key was removed and publishes a denied proof before ready", async () => {
    const key = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    const replacement = await exportJWK(
      (await generateKeyPair("EdDSA", { crv: "Ed25519" })).publicKey,
    );
    const claims = {
      schemaVersion: 1,
      licenseId: "11111111-1111-4111-8111-111111111111",
      sequence: 1,
      issuer: "cra",
      organizationId: org,
      instanceId: instance,
      issuedAt: "2026-01-01T00:00:00.000Z",
      startsAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-12-01T00:00:00.000Z",
      graceDays: 30,
      entitlements: ["products"],
      limits: { activeMembers: null, products: null, storageBytes: null },
    };
    const artifact = await new CompactSign(Buffer.from(JSON.stringify(claims)))
      .setProtectedHeader({
        alg: "EdDSA",
        kid: "removed",
        typ: "CRA-LICENCE+JWS",
      })
      .sign(key.privateKey);
    const verifier = new LocalLicenseVerifier({
      issuer: "cra",
      keys: [
        {
          kid: "replacement",
          kty: replacement.kty,
          crv: replacement.crv,
          x: replacement.x,
        },
      ],
    });
    const publishVerification = jest
      .fn()
      .mockResolvedValue({ outcome: "updated" });
    const port = {
      getWorkerState: jest.fn().mockResolvedValue({
        state: {
          artifact,
          artifact_digest: createHash("sha256").update(artifact).digest("hex"),
          verified_claims: claims,
          version: 1,
          time_high_water_at: null,
        },
        usage: {
          activeMembers: 0,
          reservedInvitations: 0,
          products: 0,
          storageBytes: 0,
          storageReservedBytes: 0,
          protectedStorageBytes: 0,
        },
        storageAccountingReady: true,
      }),
      checkpointWorker: jest.fn().mockResolvedValue({
        timeHighWaterAt: null,
        clockRollbackDetected: false,
      }),
      publishVerification,
    } as unknown as LicensingPort;
    const service = new LicensingService(
      port,
      () => Promise.resolve(verifier),
      { instanceId: instance, configuration: {}, policyRevision: 2 },
      () => new Date("2026-10-13T00:00:00.000Z"),
      () => 0,
    );
    const { repository } = fixture();
    await new LicensingStartup(
      repository,
      service,
      () => Promise.resolve(verifier),
      { instanceId: instance, trustFile: "/trust.json" },
    ).onApplicationBootstrap();
    expect(publishVerification).toHaveBeenCalledWith(
      org,
      null,
      expect.objectContaining({
        verified: false,
        capabilities: [],
        policyRevision: 2,
      }),
    );
  });
});

describe("licence policy startup repository boundary", () => {
  it("bounds and validates keyset requests and parses database pages", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { organizationIds: [org], nextCursor: org },
      error: null,
    });
    const repository = new SupabaseLicensingRepository({
      admin: () => ({ rpc }),
    } as never);
    await expect(repository.listPolicyTenants(100, null)).resolves.toEqual({
      organizationIds: [org],
      nextCursor: org,
    });
    expect(rpc).toHaveBeenCalledWith("m15_01_policy_tenants", {
      p_limit: 100,
      p_after: null,
    });
    await expect(repository.listPolicyTenants(101, null)).rejects.toThrow();
    await expect(repository.listPolicyTenants(100, "bad")).rejects.toThrow();
    expect(rpc).toHaveBeenCalledTimes(1);
    rpc.mockResolvedValue({
      data: { organizationIds: [org, instance], nextCursor: null },
      error: null,
    });
    await expect(repository.listPolicyTenants(1, null)).rejects.toThrow();
  });
});
