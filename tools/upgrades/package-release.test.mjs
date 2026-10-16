import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { signManifest, validateInputNames } from "./package-release.mjs";
test("signs exact immutable manifest bytes with purpose-separated Ed25519", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const manifest = Buffer.from('{ "release": "exact bytes" }\n');
  const compact = signManifest(manifest, privateKey, "test-key");
  const [header, payload, signature] = compact.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), {
    alg: "EdDSA",
    typ: "CRA-RELEASE+JWS",
    kid: "test-key",
  });
  assert.deepEqual(Buffer.from(payload, "base64url"), manifest);
  assert(
    verify(
      null,
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, "base64url"),
    ),
  );
  assert(
    !verify(
      null,
      Buffer.from(`${header}.${Buffer.from("tampered").toString("base64url")}`),
      publicKey,
      Buffer.from(signature, "base64url"),
    ),
  );
});
test("rejects duplicate and executable/traversal payload names", () => {
  for (const names of [
    ["../x.tar"],
    ["x.sh"],
    ["image.tar", "image.tar"],
    ["compose.yml"],
  ])
    assert.throws(() => validateInputNames(names));
  assert.doesNotThrow(() =>
    validateInputNames(["api.tar", "20261015000000_additive.sql", "sbom.json"]),
  );
});
test("packages actual image, migration and SBOM bytes and signs their complete inventory", async () => {
  const { mkdtemp, writeFile, readFile, rm, stat } =
    await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { packageRelease } = await import("./package-release.mjs");
  const dir = await mkdtemp(join(tmpdir(), "cra-release-test-"));
  try {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const key = join(dir, "test.pem");
    await writeFile(key, privateKey.export({ format: "pem", type: "pkcs8" }), {
      mode: 0o600,
    });
    const image = join(dir, "api.tar");
    await writeFile(image, "actual image archive fixture");
    const migration = join(dir, "20261015000000_additive.sql");
    await writeFile(
      migration,
      "ALTER TABLE public.fixture ADD COLUMN additive text;",
    );
    const sbom = join(dir, "sbom.json");
    await writeFile(
      sbom,
      JSON.stringify({
        bomFormat: "CycloneDX",
        components: [{ name: "fixture", version: "1.0.0" }],
      }),
    );
    const hash = "a".repeat(64);
    const manifest = {
      manifestVersion: 1,
      purpose: "cra-offline-application-release",
      issuer: "test",
      releaseId: "12345678-1234-4234-8234-123456789abc",
      version: "1.2.3",
      sequence: 1,
      issuedAt: "2026-10-15T00:00:00Z",
      expiresAt: "2026-10-16T00:00:00Z",
      platform: { os: "linux", architecture: "amd64" },
      compatibility: {
        sourceVersions: ["1.2.2"],
        sourceManifestDigests: [hash],
        sourceSchemaDigests: [hash],
        targetSchemaDigest: hash,
        supervisorVersions: ["1.0.0"],
      },
      infrastructure: {
        postgres: hash,
        auth: hash,
        rest: hash,
        storage: hash,
        supervisor: hash,
      },
      requirements: {
        diskBytes: 4096,
        memoryBytes: 4096,
        backupRequired: true,
        keyRequired: true,
      },
      expectedOutageSeconds: 300,
      licenseEffects: ["unchanged"],
      rollback: { imageOnly: true, backwardCompatible: true },
    };
    const config = join(dir, "config.json");
    await writeFile(
      config,
      JSON.stringify({
        kid: "ephemeral-test",
        manifest,
        images: [{ service: "api", digest: `sha256:${hash}`, path: image }],
        migrations: [{ path: migration }],
        sbomPath: sbom,
      }),
    );
    const out = join(dir, "release");
    await packageRelease(config, key, out);
    const signed = await readFile(join(out, "release.jws"), "utf8");
    const [header, payload, signature] = signed.split(".");
    assert(
      verify(
        null,
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature, "base64url"),
      ),
    );
    const parsed = JSON.parse(Buffer.from(payload, "base64url"));
    assert.equal(parsed.archive.entryCount, 3);
    assert.equal(
      parsed.archive.bytes,
      (await stat(join(out, "payload.tar"))).size,
    );
    assert.equal(parsed.artifacts[0].kind, "sbom");
    assert.equal(parsed.images[0].archive.bytes, (await stat(image)).size);
    assert.deepEqual(
      await readFile(join(out, "manifest.json")),
      Buffer.from(payload, "base64url"),
    );
    await assert.rejects(packageRelease(config, key, out));
    await writeFile(sbom, "{}");
    await assert.rejects(
      packageRelease(config, key, join(dir, "bad-sbom")),
      /CycloneDX/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
