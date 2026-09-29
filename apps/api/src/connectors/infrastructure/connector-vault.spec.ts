import { ConnectorVaultUnavailableError } from "../application/connector-vault.port";
import { AesGcmConnectorVault } from "./connector-vault";

const context = Object.freeze({
  orgId: "org-a",
  connectorId: "connector-a",
  secretId: "secret-a",
  credentialRevision: 1,
});
const first = Buffer.alloc(32, 1).toString("base64");
const second = Buffer.alloc(32, 2).toString("base64");
const ring = (
  activeKeyId = "first",
  keys: Record<string, string> = { first },
) => JSON.stringify({ activeKeyId, keys });

describe("connector AES-GCM vault", () => {
  it("encrypts with fresh nonces and reveals no plaintext in its envelope", () => {
    const vault = new AesGcmConnectorVault(ring());
    const envelope = vault.encrypt(context, "canary-secret");
    expect(JSON.stringify(envelope)).not.toContain("canary-secret");
    expect(vault.decrypt(context, envelope)).toBe("canary-secret");
    expect(vault.encrypt(context, "canary-secret").nonce).not.toBe(
      envelope.nonce,
    );
    expect(vault.available()).toBe(true);
    expect(vault.keyIds()).toEqual(["first"]);
  });

  it.each(["orgId", "connectorId", "secretId", "credentialRevision"] as const)(
    "authenticates %s",
    (field) => {
      const vault = new AesGcmConnectorVault(ring());
      const envelope = vault.encrypt(context, "canary-secret");
      expect(() =>
        vault.decrypt(
          {
            ...context,
            [field]: field === "credentialRevision" ? 2 : "substituted",
          },
          envelope,
        ),
      ).toThrow(ConnectorVaultUnavailableError);
    },
  );

  it.each(["ciphertext", "nonce", "authTag"] as const)(
    "rejects changed %s",
    (field) => {
      const vault = new AesGcmConnectorVault(ring());
      const envelope = vault.encrypt(context, "canary-secret");
      const bytes = Buffer.from(envelope[field], "base64");
      bytes[0] = bytes[0]! ^ 1;
      expect(() =>
        vault.decrypt(context, {
          ...envelope,
          [field]: bytes.toString("base64"),
        }),
      ).toThrow(ConnectorVaultUnavailableError);
    },
  );

  it("retains recovery keys and authenticates key identity", () => {
    const old = new AesGcmConnectorVault(ring());
    const envelope = old.encrypt(context, "canary-secret");
    const rotated = new AesGcmConnectorVault(ring("second", { first, second }));
    expect(rotated.decrypt(context, envelope)).toBe("canary-secret");
    const rewrapped = rotated.encrypt(
      context,
      rotated.decrypt(context, envelope),
    );
    expect(rewrapped.keyId).toBe("second");
    expect(
      new AesGcmConnectorVault(ring("second", { second })).decrypt(
        context,
        rewrapped,
      ),
    ).toBe("canary-secret");
    expect(() =>
      rotated.decrypt(context, { ...envelope, keyId: "second" }),
    ).toThrow(ConnectorVaultUnavailableError);
    expect(() =>
      new AesGcmConnectorVault(ring("second", { second })).decrypt(
        context,
        envelope,
      ),
    ).toThrow(ConnectorVaultUnavailableError);
    expect(() =>
      new AesGcmConnectorVault(ring("first", { first: second })).decrypt(
        context,
        envelope,
      ),
    ).toThrow(ConnectorVaultUnavailableError);
  });

  it.each([
    undefined,
    "",
    "not-json",
    "null",
    "{}",
    ring("missing"),
    ring("first", { first: "x" }),
    JSON.stringify({ activeKeyId: "first", keys: { first }, extra: true }),
  ])("fails closed without breaking construction for %p", (configuration) => {
    const vault = new AesGcmConnectorVault(configuration);
    expect(vault.available()).toBe(false);
    expect(vault.keyIds()).toEqual([]);
    expect(() => vault.encrypt(context, "canary-secret")).toThrow(
      ConnectorVaultUnavailableError,
    );
    expect(() =>
      vault.fingerprint("org-a", "connector-a", "canary-secret"),
    ).toThrow(ConnectorVaultUnavailableError);
  });

  it("uses stable purpose-separated tenant-bound fingerprints and retained key identity", () => {
    const vault = new AesGcmConnectorVault(ring());
    const digest = vault.fingerprint("org-a", "connector-a", "canary-secret");
    expect(digest.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest.digest).not.toContain("canary-secret");
    expect(vault.fingerprint("org-a", "connector-a", "canary-secret")).toEqual(
      digest,
    );
    expect(
      vault.fingerprint("org-b", "connector-a", "canary-secret"),
    ).not.toEqual(digest);
    expect(
      vault.fingerprint("org-a", "connector-b", "canary-secret"),
    ).not.toEqual(digest);
    expect(vault.fingerprint("org-a", "connector-a", "changed")).not.toEqual(
      digest,
    );
    const rotated = new AesGcmConnectorVault(ring("second", { first, second }));
    expect(
      rotated.fingerprint(
        "org-a",
        "connector-a",
        "canary-secret",
        digest.keyId,
      ),
    ).toEqual(digest);
    expect(
      rotated.fingerprint("org-a", "connector-a", "canary-secret"),
    ).not.toEqual(digest);
    expect(() =>
      rotated.fingerprint("org-a", "connector-a", "canary-secret", "missing"),
    ).toThrow(ConnectorVaultUnavailableError);
  });

  it("rejects invalid context, format, oversized and malformed secret envelopes safely", () => {
    const vault = new AesGcmConnectorVault(ring());
    expect(() =>
      vault.encrypt({ ...context, credentialRevision: 0 }, "x"),
    ).toThrow(ConnectorVaultUnavailableError);
    expect(() => vault.encrypt(context, "")).toThrow(
      ConnectorVaultUnavailableError,
    );
    expect(() => vault.encrypt(context, "x".repeat(20_001))).toThrow(
      ConnectorVaultUnavailableError,
    );
    const envelope = vault.encrypt(context, "secret");
    expect(() =>
      vault.decrypt(context, { ...envelope, format: "invalid" } as never),
    ).toThrow(ConnectorVaultUnavailableError);
    expect(() =>
      vault.decrypt(context, { ...envelope, nonce: "invalid" }),
    ).toThrow(ConnectorVaultUnavailableError);
    expect(() =>
      vault.decrypt(context, { ...envelope, authTag: "AA==" }),
    ).toThrow(ConnectorVaultUnavailableError);
    expect(() =>
      vault.decrypt(context, { ...envelope, ciphertext: "" }),
    ).toThrow(ConnectorVaultUnavailableError);
  });
});
