import type { SupabaseClient } from "@supabase/supabase-js";
import { AesGcmConnectorVault } from "./connector-vault";
import { maintainConnectorVault } from "./connector-vault-maintenance";
import { WebhookVault } from "./webhook-vault";
import { SupabaseWebhookVaultMaintenanceStore } from "./webhook-vault-maintenance.repository";

const orgId = "10000000-0000-4000-8000-000000000001";
const endpointId = "20000000-0000-4000-8000-000000000001";
const secretId = "30000000-0000-4000-8000-000000000001";
const previousId = "30000000-0000-4000-8000-000000000002";
const keys = {
  old: Buffer.alloc(32, 1).toString("base64"),
  current: Buffer.alloc(32, 2).toString("base64"),
};
const core = (activeKeyId = "old", material = keys) =>
  new AesGcmConnectorVault(JSON.stringify({ activeKeyId, keys: material }));
const context = {
  orgId,
  endpointId,
  signingKeyId: secretId,
  secretRevision: 2,
};
const envelope = new WebhookVault(core()).encrypt(
  context,
  Buffer.alloc(32, 3).toString("base64"),
);
const row = { secretId, endpointId, credentialRevision: 2, ...envelope };
const refs = {
  envelopeKeyReferences: { old: 2 },
  commandKeyReferences: { old: 1 },
  legacyEnvelopeCount: 0,
  hasMoreKeys: false,
};
const setup = () => {
  const rpc = jest
    .fn<
      Promise<{ data: unknown; error: unknown }>,
      [string, Readonly<Record<string, unknown>>]
    >()
    .mockResolvedValue({ data: [row], error: null });
  return {
    rpc,
    store: new SupabaseWebhookVaultMaintenanceStore({
      rpc,
    } as unknown as SupabaseClient),
  };
};

describe("webhook vault maintenance store", () => {
  it("lists bounded keyset pages in the webhook namespace including prior keys", async () => {
    const { store, rpc } = setup();
    const result = await store.list(
      orgId,
      "30000000-0000-4000-8000-000000000000",
      10,
    );
    expect(result).toEqual([
      {
        orgId,
        connectorId: `webhook:${endpointId}`,
        secretId,
        credentialRevision: 2,
        ...envelope,
      },
    ]);
    expect(rpc).toHaveBeenCalledWith("m1103_list_webhook_secret_envelopes", {
      p_organization_id: orgId,
      p_after_id: "30000000-0000-4000-8000-000000000000",
      p_limit: 10,
    });
    await expect(store.list(orgId, null, 101)).rejects.toThrow("pagination");
    await expect(store.list("bad", null, 10)).rejects.toThrow("scope");
    await expect(store.list(orgId, "bad", 10)).rejects.toThrow("pagination");
  });

  it("parses retained envelope and command fingerprint key references", async () => {
    const { store, rpc } = setup();
    rpc.mockResolvedValue({ data: refs, error: null });
    expect(await store.keyReferences(orgId)).toEqual(refs);
    expect(rpc).toHaveBeenCalledWith("m1103_webhook_key_references", {
      p_organization_id: orgId,
    });
    rpc.mockResolvedValue({
      data: { ...refs, legacyEnvelopeCount: 1 },
      error: null,
    });
    await expect(store.keyReferences(orgId)).rejects.toThrow();
    rpc.mockResolvedValue({ data: refs, error: { message: "secret-canary" } });
    await expect(store.keyReferences(orgId)).rejects.toThrow(
      "Webhook vault key reference read failed",
    );
  });

  it("CAS replaces the complete envelope without changing endpoint revisions", async () => {
    const { store, rpc } = setup();
    const [previous] = await store.list(orgId, null, 10);
    const next = new WebhookVault(core("current")).encrypt(
      context,
      Buffer.alloc(32, 3).toString("base64"),
    );
    rpc.mockResolvedValue({ data: [{ outcome: "updated" }], error: null });
    expect(await store.replace(orgId, previous!, next)).toBe("rewrapped");
    expect(rpc).toHaveBeenLastCalledWith("m1103_rewrap_webhook_secret_atomic", {
      p_organization_id: orgId,
      p_endpoint_id: endpointId,
      p_secret_id: secretId,
      p_expected_revision: 2,
      p_expected_envelope: envelope,
      p_next_envelope: next,
    });
    for (const outcome of ["conflict", "not_found"]) {
      rpc.mockResolvedValue({ data: [{ outcome }], error: null });
      expect(await store.replace(orgId, previous!, next)).toBe("conflict");
    }
    rpc.mockResolvedValue({
      data: [{ outcome: "invalid_request" }],
      error: null,
    });
    await expect(store.replace(orgId, previous!, next)).rejects.toThrow(
      "rejected",
    );
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(store.replace(orgId, previous!, next)).rejects.toThrow(
      "rejected",
    );
    await expect(store.replace(endpointId, previous!, next)).rejects.toThrow(
      "tenant",
    );
    await expect(
      store.replace(orgId, { ...previous!, connectorId: endpointId }, next),
    ).rejects.toThrow("identity");
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
        next,
      ),
    ).rejects.toThrow("format");
    rpc.mockResolvedValue({ data: null, error: { message: "secret-canary" } });
    await expect(store.replace(orgId, previous!, next)).rejects.toThrow(
      "update failed",
    );
  });

  it("fails safely on invalid or unbounded maintenance responses", async () => {
    const { store, rpc } = setup();
    rpc.mockResolvedValue({
      data: [{ ...row, endpointId: "bad" }],
      error: null,
    });
    await expect(store.list(orgId, null, 10)).rejects.toThrow();
    rpc.mockResolvedValue({ data: [row, row], error: null });
    await expect(store.list(orgId, null, 1)).rejects.toThrow("page");
    rpc.mockResolvedValue({ data: [row], error: null });
    await expect(store.list(orgId, secretId, 10)).rejects.toThrow("page");
    rpc.mockResolvedValue({ data: null, error: { message: "secret-canary" } });
    await expect(store.list(orgId, null, 10)).rejects.toThrow("read failed");
  });

  it("rewraps active/prior envelopes with retained fingerprint recovery and opaque reports", async () => {
    const { store, rpc } = setup();
    const priorContext = {
      ...context,
      signingKeyId: previousId,
      secretRevision: 1,
    };
    const prior = {
      secretId: previousId,
      endpointId,
      credentialRevision: 1,
      ...new WebhookVault(core()).encrypt(
        priorContext,
        Buffer.alloc(32, 4).toString("base64"),
      ),
    };
    rpc.mockImplementation((name: string) =>
      Promise.resolve({
        data: name.includes("key_references")
          ? refs
          : name.includes("list_")
            ? [row, prior]
            : [{ outcome: "updated" }],
        error: null,
      }),
    );
    const stored = await store.list(orgId, null, 10);
    expect(
      core("current").decrypt(
        {
          orgId,
          connectorId: `webhook:${endpointId}`,
          secretId,
          credentialRevision: 2,
        },
        envelope,
      ),
    ).toBe(Buffer.alloc(32, 3).toString("base64"));
    expect(await store.replace(orgId, stored[0]!, envelope)).toBe("rewrapped");
    rpc.mockClear();
    const report = await maintainConnectorVault(store, core("current"), {
      orgId,
      execute: true,
    });
    expect(report).toMatchObject({ inspected: 2, rewrapped: 2, failed: 0 });
    expect(JSON.stringify(report)).not.toContain(envelope.ciphertext);
    expect(JSON.stringify(report)).not.toContain(
      Buffer.alloc(32, 3).toString("base64"),
    );
    expect(
      rpc.mock.calls.filter(([name]) => name.includes("rewrap")),
    ).toHaveLength(2);
  });

  it("can restart after an interrupted rotation without changing credential identity", async () => {
    const { store, rpc } = setup();
    const priorContext = {
      ...context,
      signingKeyId: previousId,
      secretRevision: 1,
    };
    const prior = {
      secretId: previousId,
      endpointId,
      credentialRevision: 1,
      ...new WebhookVault(core()).encrypt(
        priorContext,
        Buffer.alloc(32, 4).toString("base64"),
      ),
    };
    let active = row;
    let previous = prior;
    const abort = new AbortController();
    rpc.mockImplementation((name, input) => {
      if (name.includes("key_references"))
        return Promise.resolve({ data: refs, error: null });
      if (name.includes("list_"))
        return Promise.resolve({ data: [active, previous], error: null });
      const next = input.p_next_envelope as typeof envelope;
      if (input.p_secret_id === secretId) {
        active = { ...active, ...next };
        abort.abort();
      } else previous = { ...previous, ...next };
      return Promise.resolve({ data: [{ outcome: "updated" }], error: null });
    });
    await expect(
      maintainConnectorVault(store, core("current"), {
        orgId,
        execute: true,
        signal: abort.signal,
      }),
    ).rejects.toThrow("interrupted");
    expect(active.keyId).toBe("current");
    expect(previous.keyId).toBe("old");
    expect(
      await maintainConnectorVault(store, core("current"), {
        orgId,
        execute: true,
      }),
    ).toMatchObject({ alreadyCurrent: 1, rewrapped: 1 });
    expect(active.credentialRevision).toBe(2);
    expect(previous.credentialRevision).toBe(1);
    expect(
      new WebhookVault(core("current")).decrypt(context, {
        format: active.format,
        keyId: active.keyId,
        ciphertext: active.ciphertext,
        nonce: active.nonce,
        authTag: active.authTag,
      }),
    ).toBe(Buffer.alloc(32, 3).toString("base64"));
  });

  it("blocks missing recovery keys, leaves concurrent replacement intact, and handles interruption", async () => {
    const { store, rpc } = setup();
    rpc.mockImplementation((name: string) =>
      Promise.resolve({
        data: name.includes("key_references")
          ? refs
          : name.includes("list_")
            ? [row]
            : [{ outcome: "conflict" }],
        error: null,
      }),
    );
    await expect(
      maintainConnectorVault(
        store,
        core("current", { current: keys.current } as typeof keys),
        { orgId, execute: true },
      ),
    ).rejects.toThrow("all retained recovery keys");
    expect(
      (
        await maintainConnectorVault(store, core("current"), {
          orgId,
          execute: true,
        })
      ).conflicts,
    ).toBe(1);
    const abort = new AbortController();
    abort.abort();
    await expect(
      maintainConnectorVault(store, core("current"), {
        orgId,
        execute: true,
        signal: abort.signal,
      }),
    ).rejects.toThrow("interrupted");
    rpc.mockImplementation((name: string) =>
      Promise.resolve({
        data: name.includes("key_references")
          ? refs
          : [{ ...row, ciphertext: "AAAA" }],
        error: null,
      }),
    );
    expect(
      (await maintainConnectorVault(store, core("current"), { orgId })).failed,
    ).toBe(1);
  });
});
