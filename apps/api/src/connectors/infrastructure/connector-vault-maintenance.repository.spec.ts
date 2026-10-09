import { SupabaseConnectorVaultMaintenanceStore } from "./connector-vault-maintenance.repository";
import { AesGcmConnectorVault } from "./connector-vault";

const orgId = "00000000-0000-4000-8000-000000000001";
const connectorId = "00000000-0000-4000-8000-000000000002";
const secretId = "00000000-0000-4000-8000-000000000003";
const context = { orgId, connectorId, secretId, credentialRevision: 1 };
const vault = new AesGcmConnectorVault(
  JSON.stringify({
    activeKeyId: "key",
    keys: { key: Buffer.alloc(32, 1).toString("base64") },
  }),
);
const envelope = vault.encrypt(context, "test-secret");
const stored = { ...context, ...envelope };
const row = {
  secretId,
  connectorId,
  credentialRevision: 1,
  ...envelope,
  revokedAt: null,
};

describe("maintenance ciphertext-only repository", () => {
  it("counts retained envelope and command fingerprint references by tenant", async () => {
    const references = {
      envelopeKeyReferences: { key: 2 },
      commandKeyReferences: { retained: 3 },
      legacyEnvelopeCount: 1,
      hasMoreKeys: false,
    };
    const rpc = jest.fn().mockResolvedValue({ data: references, error: null });
    const repository = new SupabaseConnectorVaultMaintenanceStore({
      rpc,
    } as never);
    expect(await repository.keyReferences(orgId)).toEqual(references);
    expect(rpc).toHaveBeenCalledWith("m11_connector_key_references", {
      p_organization_id: orgId,
    });
    rpc.mockResolvedValue({
      data: null,
      error: { message: "upstream-secret" },
    });
    await expect(repository.keyReferences(orgId)).rejects.toThrow(
      "Connector vault key reference read failed",
    );
  });
  it("rejects invalid pagination before transport", async () => {
    const rpc = jest.fn();
    const repository = new SupabaseConnectorVaultMaintenanceStore({
      rpc,
    } as never);
    await expect(repository.list(orgId, null, 101)).rejects.toThrow(
      "Invalid maintenance pagination",
    );
    expect(rpc).not.toHaveBeenCalled();
  });
  it("parses active envelopes and normalizes PostgreSQL base64 line breaks", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ ...row, ciphertext: `${row.ciphertext}\n` }],
      error: null,
    });
    const repository = new SupabaseConnectorVaultMaintenanceStore({
      rpc,
    } as never);
    expect(await repository.list(orgId, null, 10)).toEqual([stored]);
    expect(rpc).toHaveBeenCalledWith("m11_list_connector_secret_envelopes", {
      p_organization_id: orgId,
      p_after_id: null,
      p_limit: 10,
    });
    rpc.mockResolvedValue({
      data: [
        {
          ...row,
          format: "legacy-pgp",
          keyId: null,
          nonce: null,
          authTag: null,
        },
      ],
      error: null,
    });
    expect(await repository.list(orgId, null, 10)).toEqual([
      {
        ...stored,
        format: "legacy-pgp",
        keyId: null,
        nonce: null,
        authTag: null,
      },
    ]);
  });
  it("rejects database errors, revoked and inconsistent envelopes", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValue({ data: null, error: { message: "secret-canary" } });
    const repository = new SupabaseConnectorVaultMaintenanceStore({
      rpc,
    } as never);
    await expect(repository.list(orgId, null, 10)).rejects.toThrow(
      "Connector vault maintenance read failed",
    );
    rpc.mockResolvedValue({
      data: [{ ...row, revokedAt: "now" }],
      error: null,
    });
    await expect(repository.list(orgId, null, 10)).rejects.toThrow(
      "revoked envelope",
    );
    rpc.mockResolvedValue({ data: [{ ...row, keyId: null }], error: null });
    await expect(repository.list(orgId, null, 10)).rejects.toThrow(
      "invalid envelope",
    );
  });
  it("CAS is scoped and interprets safe outcomes", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValue({ data: [{ outcome: "updated" }], error: null });
    const repository = new SupabaseConnectorVaultMaintenanceStore({
      rpc,
    } as never);
    await expect(repository.replace(orgId, stored, envelope)).resolves.toBe(
      "rewrapped",
    );
    expect((rpc.mock.calls[0] as readonly unknown[])[1]).toMatchObject({
      p_organization_id: orgId,
      p_connector_id: connectorId,
      p_secret_id: secretId,
      p_expected_key_id: "key",
      p_expected_ciphertext: envelope.ciphertext,
    });
    for (const outcome of ["not_found", "conflict"]) {
      rpc.mockResolvedValue({ data: [{ outcome }], error: null });
      await expect(repository.replace(orgId, stored, envelope)).resolves.toBe(
        "conflict",
      );
    }
    await expect(
      repository.replace("different-org", stored, envelope),
    ).rejects.toThrow("tenant mismatch");
    rpc.mockResolvedValue({
      data: [{ outcome: "invalid_request" }],
      error: null,
    });
    await expect(repository.replace(orgId, stored, envelope)).rejects.toThrow(
      "update rejected",
    );
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(repository.replace(orgId, stored, envelope)).rejects.toThrow(
      "update rejected",
    );
    rpc.mockResolvedValue({ data: null, error: { message: "secret-canary" } });
    await expect(repository.replace(orgId, stored, envelope)).rejects.toThrow(
      "update failed",
    );
  });
});
