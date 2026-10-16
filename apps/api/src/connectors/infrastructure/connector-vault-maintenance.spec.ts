import { AesGcmConnectorVault } from "./connector-vault";
import {
  maintainConnectorVault,
  type ConnectorVaultMaintenanceStore,
  type StoredConnectorEnvelope,
} from "./connector-vault-maintenance";

const keys = {
  old: Buffer.alloc(32, 1).toString("base64"),
  current: Buffer.alloc(32, 2).toString("base64"),
};
const oldVault = new AesGcmConnectorVault(
  JSON.stringify({ activeKeyId: "old", keys }),
);
const vault = new AesGcmConnectorVault(
  JSON.stringify({ activeKeyId: "current", keys }),
);
const context = {
  orgId: "org-a",
  connectorId: "connector-a",
  secretId: "secret-a",
  credentialRevision: 2,
};
const row: StoredConnectorEnvelope = {
  ...context,
  ...oldVault.encrypt(context, "maintenance-canary"),
};
const store = (): ConnectorVaultMaintenanceStore => ({
  keyReferences: jest.fn().mockResolvedValue({
    envelopeKeyReferences: { old: 1 },
    commandKeyReferences: {},
    legacyEnvelopeCount: 0,
    hasMoreKeys: false,
  }),
  list: jest.fn().mockResolvedValue([row]),
  replace: jest.fn().mockResolvedValue("rewrapped"),
});

describe("connector vault maintenance", () => {
  it("counts key identities that collide with object prototype names", async () => {
    const constructorVault = new AesGcmConnectorVault(
      JSON.stringify({
        activeKeyId: "constructor",
        keys: { constructor: keys.current },
      }),
    );
    const constructorRow = {
      ...context,
      ...constructorVault.encrypt(context, "maintenance-canary"),
    };
    const repository = store();
    (repository.list as jest.Mock).mockResolvedValue([constructorRow]);
    const result = await maintainConnectorVault(repository, constructorVault, {
      orgId: context.orgId,
    });
    expect(result.keyReferences.constructor).toBe(1);
  });
  it("defaults to a bounded dry run that validates recovery without changing storage", async () => {
    const repository = store();
    const result = await maintainConnectorVault(repository, vault, {
      orgId: context.orgId,
      batchSize: 10,
    });
    expect(result).toMatchObject({
      inspected: 1,
      rewrapped: 0,
      conflicts: 0,
      alreadyCurrent: 0,
      failed: 0,
      dryRun: true,
      keyReferences: { old: 1 },
    });
    expect(repository.replace).not.toHaveBeenCalled();
    expect(repository.list).toHaveBeenCalledWith("org-a", null, 10);
    expect(JSON.stringify(result)).not.toContain("maintenance-canary");
  });
  it("prevents cutover when retained command fingerprint keys are missing", async () => {
    const repository = store();
    (repository.keyReferences as jest.Mock).mockResolvedValue({
      envelopeKeyReferences: { old: 1 },
      commandKeyReferences: { retired: 1 },
      legacyEnvelopeCount: 0,
      hasMoreKeys: false,
    });
    expect(
      await maintainConnectorVault(repository, vault, { orgId: context.orgId }),
    ).toMatchObject({ missingKeyIds: ["retired"] });
    await expect(
      maintainConnectorVault(repository, vault, {
        orgId: context.orgId,
        execute: true,
      }),
    ).rejects.toThrow("all retained recovery keys");
    expect(repository.replace).not.toHaveBeenCalled();
    (repository.keyReferences as jest.Mock).mockResolvedValue({
      envelopeKeyReferences: {},
      commandKeyReferences: {},
      legacyEnvelopeCount: 0,
      hasMoreKeys: true,
    });
    await expect(
      maintainConnectorVault(repository, vault, {
        orgId: context.orgId,
        execute: true,
      }),
    ).rejects.toThrow("all retained recovery keys");
    (repository.keyReferences as jest.Mock).mockResolvedValue({
      envelopeKeyReferences: {},
      commandKeyReferences: {},
      legacyEnvelopeCount: 1,
      hasMoreKeys: false,
    });
    await expect(
      maintainConnectorVault(repository, vault, {
        orgId: context.orgId,
        execute: true,
      }),
    ).rejects.toThrow("all retained recovery keys");
  });

  it("rewraps without changing credential revision using scoped ciphertext CAS", async () => {
    const repository = store();
    const result = await maintainConnectorVault(repository, vault, {
      orgId: context.orgId,
      execute: true,
      batchSize: 10,
    });
    expect(result.rewrapped).toBe(1);
    const call = (
      repository.replace as jest.MockedFunction<
        ConnectorVaultMaintenanceStore["replace"]
      >
    ).mock.calls[0]!;
    expect(call.slice(0, 2)).toEqual(["org-a", row]);
    expect(vault.decrypt(context, call[2])).toBe("maintenance-canary");
    expect(call[2].keyId).toBe("current");
  });

  it("records CAS conflicts, failures and already-current rows without leaking details", async () => {
    const current = {
      ...context,
      secretId: "secret-b",
      ...vault.encrypt(
        { ...context, secretId: "secret-b" },
        "maintenance-canary",
      ),
    };
    const invalid = { ...row, secretId: "secret-c" };
    const repository = store();
    (repository.list as jest.Mock).mockResolvedValue([row, current, invalid]);
    (repository.replace as jest.Mock).mockResolvedValue("conflict");
    const result = await maintainConnectorVault(repository, vault, {
      orgId: context.orgId,
      execute: true,
      batchSize: 10,
    });
    expect(result).toMatchObject({
      inspected: 3,
      conflicts: 1,
      failed: 1,
      alreadyCurrent: 1,
    });
  });

  it("uses bounded keyset pages and handles legacy recovery in memory only", async () => {
    const repository = store();
    const legacy = {
      ...context,
      secretId: "legacy",
      format: "legacy-pgp" as const,
      keyId: null,
      ciphertext: "bGVnYWN5",
      nonce: null,
      authTag: null,
    };
    (repository.list as jest.Mock)
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([legacy])
      .mockResolvedValueOnce([]);
    const decryptLegacy = jest.fn().mockResolvedValue("legacy-canary");
    const result = await maintainConnectorVault(
      repository,
      vault,
      { orgId: context.orgId, execute: true, batchSize: 1 },
      decryptLegacy,
    );
    expect(result.rewrapped).toBe(2);
    expect(repository.list).toHaveBeenNthCalledWith(
      2,
      "org-a",
      row.secretId,
      1,
    );
    expect(repository.list).toHaveBeenNthCalledWith(3, "org-a", "legacy", 1);
    expect(decryptLegacy).toHaveBeenCalledWith(legacy.ciphertext);
  });

  it("rejects invalid bounds, substituted tenant rows, missing recovery and cancellation", async () => {
    await expect(
      maintainConnectorVault(store(), vault, { orgId: "", batchSize: 10 }),
    ).rejects.toThrow("Invalid maintenance options");
    await expect(
      maintainConnectorVault(store(), vault, {
        orgId: "org-a",
        batchSize: 101,
      }),
    ).rejects.toThrow("Invalid maintenance options");
    const repository = store();
    (repository.list as jest.Mock).mockResolvedValue([
      { ...row, orgId: "org-b" },
    ]);
    await expect(
      maintainConnectorVault(repository, vault, { orgId: "org-a" }),
    ).rejects.toThrow("Invalid maintenance page");
    (repository.list as jest.Mock).mockResolvedValue([
      { ...row, format: "legacy-pgp", keyId: null },
    ]);
    expect(
      (await maintainConnectorVault(repository, vault, { orgId: "org-a" }))
        .failed,
    ).toBe(1);
    const abort = new AbortController();
    abort.abort();
    await expect(
      maintainConnectorVault(store(), vault, {
        orgId: "org-a",
        signal: abort.signal,
      }),
    ).rejects.toThrow("Maintenance interrupted");
  });
});
