import {
  generateKeyPair,
  exportJWK,
  CompactSign,
  type CompactJWSHeaderParameters,
} from "jose";
import { LocalLicenseVerifier } from "./local-license-verifier";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const claims = {
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
describe("local licence verifier", () => {
  let verifier: LocalLicenseVerifier;
  let sign: (
    payload?: unknown,
    header?: CompactJWSHeaderParameters,
  ) => Promise<string>;
  beforeEach(async () => {
    const key = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    const jwk = await exportJWK(key.publicKey);
    verifier = new LocalLicenseVerifier({
      issuer: "cra",
      keys: [{ kid: "key-1", kty: jwk.kty, crv: jwk.crv, x: jwk.x }],
    });
    sign = (
      payload = claims,
      header = { alg: "EdDSA", kid: "key-1", typ: "CRA-LICENCE+JWS" },
    ) =>
      new CompactSign(Buffer.from(JSON.stringify(payload)))
        .setProtectedHeader(header)
        .sign(key.privateKey);
  });
  it("verifies with all operations local", async () => {
    const result = await verifier.verify(
      await sign(),
      claims,
      new Date(claims.startsAt),
    );
    expect(result.claims).toEqual(claims);
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.keyId).toBe("key-1");
  });
  it.each([
    "unknown",
    "remote",
    "tampered",
    "binding",
    "future",
    "past",
    "schema",
    "algorithm",
    "malformed",
  ])("rejects %s artifacts", async (kind) => {
    let artifact = await sign(
      kind === "schema" ? { ...claims, extra: true } : claims,
      kind === "remote"
        ? {
            alg: "EdDSA",
            kid: "key-1",
            typ: "CRA-LICENCE+JWS",
            jku: "https://example.test/keys",
          }
        : {
            alg: "EdDSA",
            kid: kind === "unknown" ? "other" : "key-1",
            typ: "CRA-LICENCE+JWS",
          },
    );
    if (kind === "tampered")
      artifact = artifact.replace(/\.[^.]+$/, "." + "A".repeat(86));
    if (kind === "algorithm")
      artifact =
        Buffer.from(
          JSON.stringify({
            alg: "HS256",
            kid: "key-1",
            typ: "CRA-LICENCE+JWS",
          }),
        ).toString("base64url") + artifact.slice(artifact.indexOf("."));
    if (kind === "malformed") artifact = "abc";
    await expect(
      verifier.verify(
        artifact,
        {
          ...claims,
          ...(kind === "binding" ? { instanceId: claims.licenseId } : {}),
        },
        new Date(
          kind === "future"
            ? "2025-01-01T00:00:00Z"
            : kind === "past"
              ? "2026-03-03T00:00:00Z"
              : claims.startsAt,
        ),
      ),
    ).rejects.toThrow();
  });
  it("current artifacts remain verifiable beyond grace", async () =>
    expect(
      (
        await verifier.verify(
          await sign(),
          claims,
          new Date("2026-04-01T00:00:00Z"),
          { activation: false },
        )
      ).claims,
    ).toEqual(claims));
  it("rejects issuer mismatch and invalid time", async () => {
    await expect(
      verifier.verify(
        await sign({ ...claims, issuer: "other" }),
        claims,
        new Date(claims.startsAt),
      ),
    ).rejects.toThrow("wrong_issuer");
    await expect(
      verifier.verify(await sign(), claims, new Date("invalid")),
    ).rejects.toThrow("invalid_time");
  });
  it("reads only bounded local public trust files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "licence-trust-"));
    try {
      const file = join(dir, "trust.json");
      const key = await generateKeyPair("EdDSA", { crv: "Ed25519" });
      const jwk = await exportJWK(key.publicKey);
      await writeFile(
        file,
        JSON.stringify({
          issuer: "cra",
          keys: [{ kid: "key-1", kty: jwk.kty, crv: jwk.crv, x: jwk.x }],
        }),
      );
      expect(await LocalLicenseVerifier.fromFile(file)).toBeInstanceOf(
        LocalLicenseVerifier,
      );
      await writeFile(file, "a".repeat(65537));
      await expect(LocalLicenseVerifier.fromFile(file)).rejects.toThrow(
        "invalid_trust_file",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("pins trust identity independently of operator key order", () => {
    const keys = ["rotation-c", "rotation-a", "rotation-b"].map((kid) => ({
      kid,
      kty: "OKP",
      crv: "Ed25519",
      x: "A".repeat(43),
    }));
    const ordered = new LocalLicenseVerifier({ issuer: "cra", keys });
    const reordered = new LocalLicenseVerifier({
      issuer: "cra",
      keys: [...keys].reverse(),
    });
    const removed = new LocalLicenseVerifier({
      issuer: "cra",
      keys: keys.slice(1),
    });
    expect(ordered.trustDigest).toBe(reordered.trustDigest);
    expect(ordered.trustDigest).not.toBe(removed.trustDigest);
    expect(ordered.trustDigest).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects duplicate keys and private trust material", () => {
    const key = { kid: "a", kty: "OKP", crv: "Ed25519", x: "A".repeat(43) };
    expect(
      () => new LocalLicenseVerifier({ issuer: "cra", keys: [key, key] }),
    ).toThrow();
    expect(
      () =>
        new LocalLicenseVerifier({
          issuer: "cra",
          keys: [{ ...key, d: "secret" }],
        }),
    ).toThrow();
  });
});
