import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseSiemVaultMaintenanceStore } from "./siem-vault-maintenance.repository";
import { AesGcmConnectorVault } from "../../../connectors/infrastructure/connector-vault";
import { maintainConnectorVault } from "../../../connectors/infrastructure/connector-vault-maintenance";
const orgId = "10000000-0000-4000-8000-000000000001",
  destinationId = "20000000-0000-4000-8000-000000000001",
  secretId = "30000000-0000-4000-8000-000000000001";
const keys = {
  old: Buffer.alloc(32, 1).toString("base64"),
  current: Buffer.alloc(32, 2).toString("base64"),
};
const vault = (activeKeyId = "old") =>
  new AesGcmConnectorVault(JSON.stringify({ activeKeyId, keys }));
const context = {
  orgId,
  connectorId: `siem:${destinationId}`,
  secretId,
  credentialRevision: 1,
};
const envelope = vault().encrypt(
  context,
  JSON.stringify({ mode: "bearer", token: "secret-canary" }),
);
const row = { destinationId, secretId, credentialRevision: 1, ...envelope };
const references = {
  envelopeKeyReferences: { old: 1 },
  commandKeyReferences: { old: 2 },
  legacyEnvelopeCount: 0,
  hasMoreKeys: false,
};
function setup() {
  const rpc = jest
    .fn<
      Promise<{ data: unknown; error: unknown }>,
      [string, Readonly<Record<string, unknown>>]
    >()
    .mockResolvedValue({ data: [row], error: null });
  return {
    rpc,
    store: new SupabaseSiemVaultMaintenanceStore({
      rpc,
    } as unknown as SupabaseClient),
  };
}
describe("SIEM scoped vault maintenance store", () => {
  it("maps scoped immutable AAD and reads retained HMAC references", async () => {
    const { rpc, store } = setup();
    expect(await store.list(orgId, null, 50)).toEqual([
      { ...context, ...envelope },
    ]);
    expect(rpc).toHaveBeenCalledWith("m13_05_siem_vault", {
      p_organization_id: orgId,
      p_action: "list",
      p_input: { afterId: null, limit: 50 },
    });
    rpc.mockResolvedValue({ data: references, error: null });
    expect(await store.keyReferences(orgId)).toEqual(references);
  });
  it("validates scope and pagination before database reads", async () => {
    const { rpc, store } = setup();
    await expect(store.list("bad", null, 1)).rejects.toThrow();
    await expect(store.list(orgId, "bad", 1)).rejects.toThrow();
    await expect(store.list(orgId, null, 101)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects unordered, oversized and malformed provider pages", async () => {
    const { rpc, store } = setup();
    for (const rows of [
      [row, row],
      [{ ...row, credentialRevision: 0 }],
      Array.from({ length: 2 }, () => row),
    ]) {
      rpc.mockResolvedValue({ data: rows, error: null });
      await expect(store.list(orgId, null, 1)).rejects.toThrow();
    }
    rpc.mockResolvedValue({ data: [row], error: null });
    await expect(store.list(orgId, secretId, 1)).rejects.toThrow();
  });
  it("CAS rewrap preserves credential identity and distinguishes conflict", async () => {
    const { rpc, store } = setup();
    const [previous] = await store.list(orgId, null, 1);
    rpc.mockResolvedValue({ data: { outcome: "updated" }, error: null });
    const next = vault("current").encrypt(context, "secret-canary");
    expect(await store.replace(orgId, previous!, next)).toBe("rewrapped");
    expect(rpc).toHaveBeenLastCalledWith("m13_05_siem_vault", {
      p_organization_id: orgId,
      p_action: "replace",
      p_input: {
        destinationId,
        secretId,
        credentialRevision: 1,
        expectedEnvelope: envelope,
        nextEnvelope: next,
      },
    });
    rpc.mockResolvedValue({ data: { outcome: "conflict" }, error: null });
    expect(await store.replace(orgId, previous!, next)).toBe("conflict");
    rpc.mockResolvedValue({ data: { outcome: "not_found" }, error: null });
    expect(await store.replace(orgId, previous!, next)).toBe("conflict");
    rpc.mockResolvedValue({
      data: { outcome: "invalid_request" },
      error: null,
    });
    await expect(store.replace(orgId, previous!, next)).rejects.toThrow();
  });
  it("rejects cross-tenant/namespaced identities and sanitizes provider failure", async () => {
    const { rpc, store } = setup();
    const [previous] = await store.list(orgId, null, 1);
    await expect(
      store.replace(orgId, { ...previous!, orgId: destinationId }, envelope),
    ).rejects.toThrow();
    await expect(
      store.replace(
        orgId,
        { ...previous!, connectorId: "webhook:bad" },
        envelope,
      ),
    ).rejects.toThrow();
    await expect(
      store.replace(
        orgId,
        {
          ...previous!,
          format: "legacy-pgp",
          keyId: null,
          nonce: null,
          authTag: null,
        },
        envelope,
      ),
    ).rejects.toThrow();
    rpc.mockResolvedValue({ data: null, error: { message: "secret-canary" } });
    await expect(store.list(orgId, null, 1)).rejects.toThrow(
      "SIEM vault maintenance failed",
    );
    await expect(store.keyReferences(orgId)).rejects.toThrow(
      "SIEM vault maintenance failed",
    );
    await expect(store.replace(orgId, previous!, envelope)).rejects.toThrow(
      "SIEM vault maintenance failed",
    );
  });
  it("reuses bounded generic rewrap and retains immutable fingerprint keys", async () => {
    const { rpc, store } = setup();
    rpc.mockImplementation((_name, input) => {
      if (input.p_action === "references")
        return Promise.resolve({ data: references, error: null });
      if (input.p_action === "replace")
        return Promise.resolve({ data: { outcome: "updated" }, error: null });
      return Promise.resolve({
        data: (input.p_input as { afterId: null | string }).afterId
          ? []
          : [row],
        error: null,
      });
    });
    const result = await maintainConnectorVault(store, vault("current"), {
      orgId,
      execute: true,
      batchSize: 1,
    });
    expect(result.rewrapped).toBe(1);
    expect(result.retainedKeyReferences.commandKeyReferences).toEqual({
      old: 2,
    });
  });
});
