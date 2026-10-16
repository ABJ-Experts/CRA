import { generateKeyPairSync, sign, createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MountedUpgradeMediaVerifier } from "./mounted-upgrade-media";
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
function tar(name = "api.tar", type = "0"): Buffer {
  const header = Buffer.alloc(512);
  header.write(name);
  header.write("0000600\0", 100);
  header.write("0000000\0", 108);
  header.write("0000000\0", 116);
  header.write("00000000003\0", 124);
  header.write("00000000000\0", 136);
  header.fill(32, 148, 156);
  header.write(type, 156);
  const sum = header.reduce((a, b) => a + b, 0);
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return Buffer.concat([
    header,
    Buffer.from("abc"),
    Buffer.alloc(509),
    Buffer.alloc(1024),
  ]);
}
describe("mounted signed upgrade media", () => {
  let root: string;
  const pair = generateKeyPairSync("ed25519");
  const publicKey = pair.publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const trust = {
    version: 1,
    minimumVersion: 1,
    keys: [
      {
        kid: "release",
        issuer: "cra",
        publicKey,
        notBefore: "2026-01-01T00:00:00Z",
        notAfter: "2027-01-01T00:00:00Z",
        revoked: false,
      },
    ],
  };
  const now = () => Date.parse("2026-10-15T12:00:00Z");
  const config = () => ({
    inboxRoot: join(root, "inbox"),
    stagingRoot: join(root, "stage"),
    trust,
    now,
  });
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "release-"));
    await mkdir(join(root, "inbox"));
    await mkdir(join(root, "inbox", "media"));
    await mkdir(join(root, "stage"), { mode: 0o700 });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  async function fixture(
    options: {
      archive?: Buffer;
      manifest?: Record<string, unknown>;
      header?: Record<string, unknown>;
      signature?: string;
    } = {},
  ) {
    const first = options.archive ?? tar();
    const artifact = tar("sbom.json");
    const archive = Buffer.concat([
      first.subarray(0, first.length - 1024),
      artifact,
    ]);
    const d = "a".repeat(64);
    const manifest = {
      manifestVersion: 1,
      purpose: "cra-offline-application-release",
      issuer: "cra",
      releaseId: "7a80b0af-c932-48dd-b1cf-a9addb620d12",
      version: "1.2.3",
      sequence: 1,
      issuedAt: "2026-10-15T00:00:00Z",
      expiresAt: "2026-11-15T00:00:00Z",
      platform: { os: "linux", architecture: "amd64" },
      compatibility: {
        sourceVersions: ["1.2.2"],
        sourceManifestDigests: [d],
        sourceSchemaDigests: [d],
        targetSchemaDigest: d,
        supervisorVersions: ["1.0.0"],
      },
      infrastructure: {
        postgres: d,
        auth: d,
        rest: d,
        storage: d,
        supervisor: d,
      },
      archive: {
        name: "payload.tar",
        bytes: archive.length,
        sha256: hash(archive),
        expandedBytes: 6,
        entryCount: 2,
      },
      images: [
        {
          service: "api",
          digest: `sha256:${d}`,
          archive: {
            name: "api.tar",
            bytes: 3,
            sha256: hash(Buffer.from("abc")),
          },
        },
      ],
      migrations: [],
      artifacts: [
        {
          name: "sbom.json",
          sha256: hash(Buffer.from("abc")),
          bytes: 3,
          kind: "sbom",
        },
      ],
      requirements: {
        diskBytes: 1,
        memoryBytes: 1,
        backupRequired: true,
        keyRequired: true,
      },
      expectedOutageSeconds: 1,
      licenseEffects: ["unchanged"],
      rollback: { imageOnly: true, backwardCompatible: true },
      ...options.manifest,
    };
    const header = Buffer.from(
      JSON.stringify({
        alg: "EdDSA",
        typ: "CRA-RELEASE+JWS",
        kid: "release",
        ...options.header,
      }),
    ).toString("base64url");
    const payload = Buffer.from(JSON.stringify(manifest)).toString("base64url");
    const sig =
      options.signature ??
      sign(null, Buffer.from(`${header}.${payload}`), pair.privateKey).toString(
        "base64url",
      );
    await writeFile(
      join(root, "inbox", "media", "release.jws"),
      `${header}.${payload}.${sig}`,
    );
    await writeFile(join(root, "inbox", "media", "payload.tar"), archive);
  }
  it("stages authenticated exact bytes and exposes only opaque discovery aliases", async () => {
    await fixture();
    const verifier = new MountedUpgradeMediaVerifier(config());
    expect(await verifier.listAliases()).toEqual(["media"]);
    const verified = await verifier.verify("media");
    expect(verified.manifest.version).toBe("1.2.3");
    expect(verified.manifestDigest).toHaveLength(64);
  });
  it.each([
    { header: { alg: "none" } },
    { header: { typ: "JWT" } },
    { header: { jku: "https://evil" } },
    { header: { kid: "unknown" } },
    { manifest: { issuer: "other" } },
    { manifest: { expiresAt: "2026-10-15T01:00:00Z" } },
    { manifest: { issuedAt: "2026-10-16T00:00:00Z" } },
    { signature: "AAAA" },
  ])("rejects invalid signature/purpose/time/trust %j", async (options) => {
    await fixture(options);
    await expect(
      new MountedUpgradeMediaVerifier(config()).verify("media"),
    ).rejects.toThrow();
  });
  it.each(["../escape", "/absolute", "bad/name"])(
    "rejects alias %s",
    async (alias) => {
      await expect(
        new MountedUpgradeMediaVerifier(config()).verify(alias),
      ).rejects.toThrow();
    },
  );
  it.each([
    ["../escape", "0"],
    ["api.tar", "2"],
    ["extra.tar", "0"],
  ])("rejects hostile inventory %s/%s", async (name, type) => {
    await fixture({ archive: tar(name, type) });
    await expect(
      new MountedUpgradeMediaVerifier(config()).verify("media"),
    ).rejects.toThrow();
  });
  it("rejects substitution, revoked trust, oversized archive and symlinks", async () => {
    await fixture();
    await writeFile(
      join(root, "inbox", "media", "payload.tar"),
      tar("bad.tar"),
    );
    await expect(
      new MountedUpgradeMediaVerifier(config()).verify("media"),
    ).rejects.toThrow();
    await fixture();
    await expect(
      new MountedUpgradeMediaVerifier({
        ...config(),
        maxArchiveBytes: 1,
      }).verify("media"),
    ).rejects.toThrow();
    await expect(
      new MountedUpgradeMediaVerifier({
        ...config(),
        trust: {
          ...trust,
          keys: trust.keys.map((key) => ({ ...key, revoked: true })),
        },
      }).verify("media"),
    ).rejects.toThrow();
    await rm(join(root, "inbox", "media", "payload.tar"));
    await symlink("/etc/passwd", join(root, "inbox", "media", "payload.tar"));
    await expect(
      new MountedUpgradeMediaVerifier(config()).verify("media"),
    ).rejects.toThrow();
  });
  it("revalidates current trust and rejects staged tampering and arbitrary paths", async () => {
    await fixture();
    const verifier = new MountedUpgradeMediaVerifier(config());
    const bundle = await verifier.verify("media");
    await expect(verifier.revalidate(bundle)).resolves.toBeUndefined();
    await expect(
      verifier.revalidate({ ...bundle, stagingId: "../outside" }),
    ).rejects.toThrow();
    await expect(
      verifier.revalidate({ ...bundle, extractedRoot: "/etc" }),
    ).rejects.toThrow();
    await expect(
      new MountedUpgradeMediaVerifier({
        ...config(),
        trust: {
          ...trust,
          keys: trust.keys.map((key) => ({ ...key, revoked: true })),
        },
      }).revalidate(bundle),
    ).rejects.toThrow();
    await writeFile(join(bundle.extractedRoot, "api.tar"), "xyz");
    await expect(verifier.revalidate(bundle)).rejects.toThrow();
  });
  it("removes only its uncommitted failed stage", async () => {
    await fixture();
    const verifier = new MountedUpgradeMediaVerifier(config());
    const bundle = await verifier.verify("media");
    await fixture({ signature: "AAAA" });
    await expect(verifier.verify("media")).rejects.toThrow();
    expect(await readdir(config().stagingRoot)).toEqual([bundle.stagingId]);
  });
});
