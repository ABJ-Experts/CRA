import {
  createPrivateKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";

import {
  BundleVerificationError,
  canonicalBundleManifest,
  type OfflineBundleTrustedKeyring,
  verifyOfflineBundle,
} from "./offline-bundle-verifier";

const now = "2026-08-27T00:00:00.000Z";

function fixture() {
  const keys = generateKeyPairSync("ed25519");
  const payload = Buffer.from('[{"id":"CVE-2026-0001"}]');
  const manifest = {
    format: "cra.vulnerability.offline-bundle",
    schemaVersion: "1.0",
    bundleVersion: "1.0.0",
    createdAt: now,
    signingKeyId: "offline-root-2026",
    compatibility: {
      minimumApplicationVersion: "1.0.0",
      maximumApplicationVersionExclusive: "2.0.0",
    },
    payloads: [
      {
        path: "nvd.json",
        feedKey: "nvd",
        schemaVersion: "1.0",
        sourceSnapshotAt: now,
        byteLength: payload.byteLength,
        sha256:
          "1acdfd66ad1614b418c5e46e8995c61b6c3dc39f19087a7cebaee5ac1d000745",
      },
    ],
  } as const;
  const signature = sign(
    null,
    Buffer.from(
      `CRA-VULNERABILITY-BUNDLE-V1\n${canonicalBundleManifest(manifest)}`,
    ),
    createPrivateKey(keys.privateKey.export({ format: "pem", type: "pkcs8" })),
  );
  return {
    manifest,
    payloads: new Map([
      [
        "nvd.json",
        {
          byteLength: payload.byteLength,
          sha256:
            "1acdfd66ad1614b418c5e46e8995c61b6c3dc39f19087a7cebaee5ac1d000745",
        },
      ],
    ]),
    signature,
    keyring: {
      keys: [
        {
          keyId: "offline-root-2026",
          publicKey: publicKeyPem(keys.publicKey),
          notBefore: "2026-01-01T00:00:00.000Z",
          notAfter: "2027-01-01T00:00:00.000Z",
          revokedAt: null,
        },
      ],
    },
  };
}

describe("verifyOfflineBundle", () => {
  it("verifies the domain-separated canonical manifest and every named payload", () => {
    const input = fixture();

    const result = verifyOfflineBundle({
      ...input,
      applicationVersion: "1.4.0",
      now: new Date(now),
    });

    expect(result).toMatchObject({
      signingKeyId: "offline-root-2026",
      compatibility: "compatible",
      payloadCount: 1,
    });
    expect(result.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    [
      "tampered signature",
      (input: ReturnType<typeof fixture>) =>
        Buffer.from(input.signature).fill(0),
    ],
    [
      "wrong payload hash",
      () => new Map([["nvd.json", { byteLength: 1, sha256: "0".repeat(64) }]]),
    ],
  ])("rejects %s without returning signature material", (_name, alter) => {
    const input = fixture();
    const changed = alter(input);
    const options =
      changed instanceof Map ? { payloads: changed } : { signature: changed };

    expect(() =>
      verifyOfflineBundle({
        ...input,
        ...options,
        applicationVersion: "1.4.0",
        now: new Date(now),
      }),
    ).toThrow(BundleVerificationError);
  });

  it("rejects unordered or extra payloads before promotion", () => {
    const input = fixture();
    const unordered = {
      ...input.manifest,
      payloads: [
        { ...input.manifest.payloads[0], path: "z.json" },
        { ...input.manifest.payloads[0], path: "a.json" },
      ],
    };

    expect(() =>
      verifyOfflineBundle({
        ...input,
        manifest: unordered,
        applicationVersion: "1.4.0",
        now: new Date(now),
      }),
    ).toThrow("payload_inventory_invalid");

    expect(() =>
      verifyOfflineBundle({
        ...input,
        payloads: new Map([
          ...input.payloads,
          ["extra.json", { byteLength: 1, sha256: "0".repeat(64) }],
        ]),
        applicationVersion: "1.4.0",
        now: new Date(now),
      }),
    ).toThrow("payload_inventory_invalid");
  });

  it("fails closed for untrusted, revoked, or incompatible deployments", () => {
    const input = fixture();
    const revoked: OfflineBundleTrustedKeyring = {
      keys: [
        {
          ...input.keyring.keys[0]!,
          revokedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
    };

    expect(() =>
      verifyOfflineBundle({
        ...input,
        keyring: { keys: [] },
        applicationVersion: "1.4.0",
        now: new Date(now),
      }),
    ).toThrow(BundleVerificationError);
    expect(() =>
      verifyOfflineBundle({
        ...input,
        keyring: revoked,
        applicationVersion: "1.4.0",
        now: new Date(now),
      }),
    ).toThrow(BundleVerificationError);
    expect(() =>
      verifyOfflineBundle({
        ...input,
        applicationVersion: "2.0.0",
        now: new Date(now),
      }),
    ).toThrow(BundleVerificationError);
  });

  it("ignores SemVer build metadata when enforcing bundle compatibility", () => {
    const input = fixture();

    expect(() =>
      verifyOfflineBundle({
        ...input,
        applicationVersion: "1.4.0+cra.7",
        now: new Date(now),
      }),
    ).not.toThrow();
  });

  it("rejects a non-Ed25519 trusted key without leaking a crypto exception", () => {
    const input = fixture();
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });

    expect(() =>
      verifyOfflineBundle({
        ...input,
        keyring: {
          keys: [
            {
              ...input.keyring.keys[0]!,
              publicKey: publicKeyPem(rsa.publicKey),
            },
          ],
        },
        applicationVersion: "1.4.0",
        now: new Date(now),
      }),
    ).toThrow("bundle_key_untrusted");
  });
});

function publicKeyPem(key: KeyObject): string {
  return key.export({ format: "pem", type: "spki" }).toString();
}
