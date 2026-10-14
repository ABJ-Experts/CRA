import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { generateKeyPair, exportJWK, CompactSign } from "jose";
import { SupabaseLicensingRepository } from "../../licensing/infrastructure/supabase-licensing.repository";
import { createLocalMetadataEnricher } from "./operator-local-sources";
import { operatorInstanceMetadataResponseSchema } from "@repo/contracts";
it("reads actual configured build identity across worker restarts and rejects invented invalid identity", async () => {
  const stamp = "2026-01-01T00:00:00.000Z";
  const id = "20000000-0000-4000-8000-000000000001";
  const metadata = operatorInstanceMetadataResponseSchema.parse({
    schemaVersion: 1,
    instanceId: id,
    revision: 1,
    sourceAt: stamp,
    observedAt: stamp,
    instance: { instanceId: id, label: "Local" },
    tenants: [],
    nextCursor: null,
  });
  const env = {
    SYSTEM_HEALTH_BUILD_MANIFEST: JSON.stringify({
      version: "1.0",
      commit: "abcdef0",
      builtAt: stamp,
    }),
    OPERATOR_EXPECTED_VERSION: "1.1",
  };
  expect(
    (
      await createLocalMetadataEnricher(env, "key").enrich(
        metadata,
        AbortSignal.timeout(1000),
      )
    ).instance.version,
  ).toBe("1.0");
  expect(
    (
      await createLocalMetadataEnricher(
        {
          ...env,
          SYSTEM_HEALTH_BUILD_MANIFEST: JSON.stringify({
            version: "1.1",
            commit: "abcdef1",
            builtAt: stamp,
          }),
        },
        "key",
      ).enrich(metadata, AbortSignal.timeout(1000))
    ).instance.versionDrift,
  ).toBe("matched");
  expect(() =>
    createLocalMetadataEnricher(
      {
        ...env,
        SYSTEM_HEALTH_BUILD_MANIFEST: '{"version":"invented","secret":"x"}',
      },
      "key",
    ),
  ).toThrow();
});
it("verifies mounted offline signing trust and observes a renewed licence without restarting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "operator-local-trust-"));
  try {
    const pair = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    const jwk = await exportJWK(pair.publicKey);
    const path = join(directory, "trust.json");
    await writeFile(
      path,
      JSON.stringify({
        issuer: "cra",
        keys: [{ kid: "task-key", kty: jwk.kty, crv: jwk.crv, x: jwk.x }],
      }),
    );
    const id = "20000000-0000-4000-8000-000000000001";
    const tenantId = "30000000-0000-4000-8000-000000000001";
    const stamp = new Date().toISOString();
    const base = {
      schemaVersion: 1 as const,
      licenseId: "40000000-0000-4000-8000-000000000001",
      sequence: 1,
      issuer: "cra",
      organizationId: tenantId,
      instanceId: id,
      issuedAt: "2026-01-01T00:00:00.000Z",
      startsAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
      graceDays: 30 as const,
      entitlements: ["products" as const],
      limits: { activeMembers: 10, products: null, storageBytes: 10000 },
    };
    const state = async (claims: typeof base) => {
      const artifact = await new CompactSign(
        Buffer.from(JSON.stringify(claims)),
      )
        .setProtectedHeader({
          alg: "EdDSA",
          kid: "task-key",
          typ: "CRA-LICENCE+JWS",
        })
        .sign(pair.privateKey);
      return {
        state: {
          organization_id: tenantId,
          artifact,
          artifact_digest: createHash("sha256").update(artifact).digest("hex"),
          verified_claims: claims,
          issuance_sequence: claims.sequence,
          version: claims.sequence,
          time_high_water_at: null,
          protected_regulatory_cutoff: null,
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
      };
    };
    const get = jest
      .spyOn(SupabaseLicensingRepository.prototype, "getWorkerState")
      .mockResolvedValue(await state(base));
    jest
      .spyOn(SupabaseLicensingRepository.prototype, "checkpointWorker")
      .mockResolvedValue({
        timeHighWaterAt: null,
        clockRollbackDetected: false,
      });
    jest
      .spyOn(SupabaseLicensingRepository.prototype, "publishVerification")
      .mockResolvedValue({ outcome: "updated" });
    const enricher = createLocalMetadataEnricher(
      {
        LICENSING_TRUST_FILE: path,
        LICENSING_INSTANCE_ID: id,
        SUPABASE_URL: "http://127.0.0.1:54321",
        SUPABASE_ANON_KEY: "configured-anon",
      },
      "worker-credential",
    );
    const metadata = operatorInstanceMetadataResponseSchema.parse({
      schemaVersion: 1,
      instanceId: id,
      revision: 1,
      sourceAt: stamp,
      observedAt: stamp,
      instance: { instanceId: id, label: "Local" },
      tenants: [{ tenantId, label: "Scoped" }],
      nextCursor: null,
    });
    expect(
      (await enricher.enrich(metadata, AbortSignal.timeout(1000))).tenants[0]!
        .licenceState,
    ).toBe("active");
    get.mockResolvedValue(
      await state({
        ...base,
        sequence: 2,
        expiresAt: "2028-01-01T00:00:00.000Z",
      }),
    );
    expect(
      (await enricher.enrich(metadata, AbortSignal.timeout(1000))).tenants[0]!
        .licenceExpiresAt,
    ).toBe("2028-01-01T00:00:00.000Z");
  } finally {
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  }
});
