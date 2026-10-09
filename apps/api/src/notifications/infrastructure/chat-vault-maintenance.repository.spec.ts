import type { SupabaseClient } from "@supabase/supabase-js";
import { AesGcmConnectorVault } from "../../connectors/infrastructure/connector-vault";
import { maintainConnectorVault } from "../../connectors/infrastructure/connector-vault-maintenance";
import { SupabaseChatVaultMaintenanceStore } from "./chat-vault-maintenance.repository";

const orgId = "10000000-0000-4000-8000-000000000001";
const channelId = "20000000-0000-4000-8000-000000000001";
const keys = {
  old: Buffer.alloc(32, 1).toString("base64"),
  current: Buffer.alloc(32, 2).toString("base64"),
};
const vault = (activeKeyId: "old" | "current") =>
  new AesGcmConnectorVault(JSON.stringify({ activeKeyId, keys }));
const context = {
  orgId,
  connectorId: channelId,
  secretId: channelId,
  credentialRevision: 3,
};
const oldEnvelope = vault("old").encrypt(context, "chat-secret");
const row = {
  channel_id: channelId,
  credential_revision: 3,
  credential_envelope: oldEnvelope,
};

function setup() {
  const rpc = jest
    .fn<
      Promise<{ data: unknown; error: unknown }>,
      [string, Record<string, unknown>]
    >()
    .mockResolvedValue({ data: [row], error: null });
  return {
    rpc,
    store: new SupabaseChatVaultMaintenanceStore({
      rpc,
    } as unknown as SupabaseClient),
  };
}

describe("chat vault maintenance store", () => {
  it("lists only a bounded, ordered organization page and preserves AAD identity", async () => {
    const { rpc, store } = setup();
    expect(await store.list(orgId, null, 50)).toEqual([
      { ...context, ...oldEnvelope },
    ]);
    expect(rpc).toHaveBeenCalledWith("m12_05_list_chat_envelopes", {
      p_organization_id: orgId,
      p_after_id: null,
      p_limit: 50,
    });
    await expect(store.list("bad", null, 10)).rejects.toThrow("scope");
    await expect(store.list(orgId, "bad", 10)).rejects.toThrow("pagination");
    await expect(store.list(orgId, null, 101)).rejects.toThrow("pagination");
    expect(rpc).toHaveBeenCalledTimes(1);
    rpc.mockResolvedValueOnce({
      data: [{ ...row, channel_id: "10000000-0000-4000-8000-000000000000" }],
      error: null,
    });
    await expect(store.list(orgId, channelId, 50)).rejects.toThrow("page");
  });

  it("counts retained keys by scanning bounded tenant pages without exposing ciphertext", async () => {
    const { rpc, store } = setup();
    rpc.mockResolvedValueOnce({ data: [row], error: null });
    expect(await store.keyReferences(orgId)).toEqual({
      envelopeKeyReferences: { old: 1 },
      commandKeyReferences: {},
      legacyEnvelopeCount: 0,
      hasMoreKeys: false,
    });
    expect(rpc).toHaveBeenNthCalledWith(1, "m12_05_list_chat_envelopes", {
      p_organization_id: orgId,
      p_after_id: null,
      p_limit: 100,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("uses full-envelope optimistic CAS and treats concurrent replacement as conflict", async () => {
    const { rpc, store } = setup();
    const next = vault("current").encrypt(context, "chat-secret");
    const previous = { ...context, ...oldEnvelope };
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await store.replace(orgId, previous, next)).toBe("rewrapped");
    expect(rpc).toHaveBeenCalledWith("m12_05_rewrap_chat_envelope_atomic", {
      p_organization_id: orgId,
      p_channel_id: channelId,
      p_expected_credential_revision: 3,
      p_expected_envelope: oldEnvelope,
      p_new_envelope: next,
    });
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await store.replace(orgId, previous, next)).toBe("conflict");
    await expect(
      store.replace("30000000-0000-4000-8000-000000000001", previous, next),
    ).rejects.toThrow("tenant mismatch");
  });

  it("rotates safely and reports missing retained keys without logging secrets", async () => {
    const { rpc, store } = setup();
    rpc.mockResolvedValueOnce({ data: [row], error: null });
    rpc.mockResolvedValueOnce({ data: [row], error: null });
    rpc.mockResolvedValueOnce({ data: true, error: null });
    const result = await maintainConnectorVault(store, vault("current"), {
      orgId,
      batchSize: 100,
      execute: true,
    });
    expect(result).toMatchObject({
      inspected: 1,
      rewrapped: 1,
      failed: 0,
      missingKeyIds: [],
    });
    expect(JSON.stringify(result)).not.toContain("chat-secret");
    const onlyCurrent = new AesGcmConnectorVault(
      JSON.stringify({
        activeKeyId: "current",
        keys: { current: keys.current },
      }),
    );
    const unavailable = setup();
    unavailable.rpc.mockResolvedValueOnce({ data: [row], error: null });
    await expect(
      maintainConnectorVault(unavailable.store, onlyCurrent, {
        orgId,
        execute: true,
      }),
    ).rejects.toThrow("retained recovery keys");
  });

  it("redacts RPC errors and rejects malformed envelope rows", async () => {
    const { rpc, store } = setup();
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "secret-canary" },
    });
    await expect(store.list(orgId, null, 10)).rejects.toThrow(
      "Chat vault maintenance read failed",
    );
    rpc.mockResolvedValueOnce({
      data: [{ ...row, credential_envelope: { ...oldEnvelope, keyId: null } }],
      error: null,
    });
    await expect(store.list(orgId, null, 10)).rejects.toThrow();
  });
});
