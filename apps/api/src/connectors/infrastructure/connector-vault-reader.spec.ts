import { ConnectorVaultUnavailableError } from "../application/connector-vault.port";
import { AesGcmConnectorVault } from "./connector-vault";
import { ConnectorCredentialReader } from "./connector-vault-reader";

const context = {
  orgId: "org-a",
  connectorId: "connector-a",
  secretId: "secret-a",
  credentialRevision: 1,
};
const vault = new AesGcmConnectorVault(
  JSON.stringify({
    activeKeyId: "key",
    keys: { key: Buffer.alloc(32, 1).toString("base64") },
  }),
);

describe("compatible credential reader", () => {
  it("uses GCM and scoped AAD without involving the legacy reader", async () => {
    const decryptLegacy = jest.fn();
    const reader = new ConnectorCredentialReader(vault, "old-key", {
      decryptLegacy,
    });
    const stored = {
      envelope: vault.encrypt(context, "reader-canary"),
      legacy: false,
    };
    await expect(reader.read(context, stored)).resolves.toBe("reader-canary");
    await expect(
      reader.read({ ...context, orgId: "substituted" }, stored),
    ).rejects.toThrow(ConnectorVaultUnavailableError);
    expect(decryptLegacy).not.toHaveBeenCalled();
  });
  it("bridges old active PGP without sending passphrases to storage", async () => {
    const decryptLegacy = jest.fn().mockResolvedValue("legacy-canary");
    const reader = new ConnectorCredentialReader(
      new AesGcmConnectorVault(),
      "old-key",
      { binary: "/opt/homebrew/bin/gpg", decryptLegacy },
    );
    const signal = new AbortController().signal;
    await expect(
      reader.read(
        context,
        { envelope: null, legacy: true, legacyCiphertextBase64: "Y2lwaGVy" },
        signal,
      ),
    ).resolves.toBe("legacy-canary");
    expect(decryptLegacy).toHaveBeenCalledWith("Y2lwaGVy", "old-key", {
      binary: "/opt/homebrew/bin/gpg",
      signal,
    });
  });
  it("fails safely for absent, wrong, canceled or inconsistent recovery data", async () => {
    const decryptLegacy = jest
      .fn()
      .mockRejectedValue(new Error("provider-secret-canary"));
    const reader = new ConnectorCredentialReader(vault, "old-key", {
      decryptLegacy,
    });
    await expect(
      reader.read(context, { envelope: null, legacy: true }),
    ).rejects.toThrow(ConnectorVaultUnavailableError);
    await expect(
      reader.read(context, { envelope: null, legacy: false }),
    ).rejects.toThrow(ConnectorVaultUnavailableError);
    await expect(
      reader.read(context, {
        envelope: null,
        legacy: true,
        legacyCiphertextBase64: "Y2lwaGVy",
      }),
    ).rejects.toThrow(ConnectorVaultUnavailableError);
    await expect(
      new ConnectorCredentialReader(vault).read(context, {
        envelope: null,
        legacy: true,
        legacyCiphertextBase64: "Y2lwaGVy",
      }),
    ).rejects.toThrow(ConnectorVaultUnavailableError);
    const abort = new AbortController();
    abort.abort();
    await expect(
      reader.read(
        context,
        { envelope: vault.encrypt(context, "reader-canary"), legacy: false },
        abort.signal,
      ),
    ).rejects.toThrow(ConnectorVaultUnavailableError);
  });
});
