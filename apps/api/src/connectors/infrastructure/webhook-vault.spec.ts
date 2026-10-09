import { ConnectorVaultUnavailableError } from "../application/connector-vault.port";
import { AesGcmConnectorVault } from "./connector-vault";
import { WebhookVault } from "./webhook-vault";

const context = {
  orgId: "10000000-0000-4000-8000-000000000001",
  endpointId: "20000000-0000-4000-8000-000000000001",
  signingKeyId: "30000000-0000-4000-8000-000000000001",
  secretRevision: 1,
};
const keys = {
  old: Buffer.alloc(32, 1).toString("base64"),
  current: Buffer.alloc(32, 2).toString("base64"),
};
const ring = (activeKeyId = "old", material = keys) =>
  new AesGcmConnectorVault(JSON.stringify({ activeKeyId, keys: material }));
const secret = Buffer.alloc(32, 3).toString("base64");

describe("webhook vault namespace", () => {
  it("wraps the existing vault without sharing a connector identity or exposing plaintext", () => {
    const core = ring();
    const vault = new WebhookVault(core);
    const envelope = vault.encrypt(context, secret);
    expect(vault.available()).toBe(true);
    expect(vault.keyIds()).toEqual(["old", "current"]);
    expect(vault.decrypt(context, envelope)).toBe(secret);
    expect(JSON.stringify(envelope)).not.toContain(secret);
    expect(() =>
      core.decrypt(
        {
          orgId: context.orgId,
          connectorId: context.endpointId,
          secretId: context.signingKeyId,
          credentialRevision: 1,
        },
        envelope,
      ),
    ).toThrow(ConnectorVaultUnavailableError);
    expect(vault.encrypt(context, secret).nonce).not.toEqual(envelope.nonce);
  });

  it.each(["orgId", "endpointId", "signingKeyId", "secretRevision"] as const)(
    "authenticates %s",
    (field) => {
      const vault = new WebhookVault(ring());
      const envelope = vault.encrypt(context, secret);
      expect(() =>
        vault.decrypt(
          {
            ...context,
            [field]:
              field === "secretRevision"
                ? 2
                : "40000000-0000-4000-8000-000000000001",
          },
          envelope,
        ),
      ).toThrow(ConnectorVaultUnavailableError);
    },
  );

  it.each(["ciphertext", "nonce", "authTag"] as const)(
    "rejects tampered %s",
    (field) => {
      const vault = new WebhookVault(ring());
      const envelope = vault.encrypt(context, secret);
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

  it("recovers old keys, but rejects missing/wrong master keys and malformed contexts", () => {
    const envelope = new WebhookVault(ring()).encrypt(context, secret);
    expect(new WebhookVault(ring("current")).decrypt(context, envelope)).toBe(
      secret,
    );
    for (const core of [
      new AesGcmConnectorVault(),
      ring("current", { old: keys.current, current: keys.current }),
      ring("current", { current: keys.current } as typeof keys),
    ]) {
      expect(() => new WebhookVault(core).decrypt(context, envelope)).toThrow(
        ConnectorVaultUnavailableError,
      );
    }
    const vault = new WebhookVault(ring());
    expect(() =>
      vault.encrypt({ ...context, endpointId: "not-uuid" }, secret),
    ).toThrow(ConnectorVaultUnavailableError);
    expect(() => vault.encrypt(context, "not-base64")).toThrow(
      ConnectorVaultUnavailableError,
    );
    expect(new WebhookVault(new AesGcmConnectorVault()).available()).toBe(
      false,
    );
  });

  it("uses tenant/endpoint and purpose-separated fingerprints with old-key retry recovery", () => {
    const core = ring();
    const vault = new WebhookVault(core);
    expect(
      vault.fingerprint(
        context.orgId,
        "00000000-0000-0000-0000-000000000000",
        "create",
      ),
    ).toEqual(
      vault.fingerprint(
        context.orgId,
        "00000000-0000-0000-0000-000000000000",
        "create",
      ),
    );
    const fingerprint = vault.fingerprint(
      context.orgId,
      context.endpointId,
      '{"secret":"canary"}',
    );
    expect(fingerprint.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(
      vault.fingerprint(
        context.orgId,
        context.endpointId,
        '{"secret":"canary"}',
      ),
    ).toEqual(fingerprint);
    expect(
      core.fingerprint(
        context.orgId,
        context.endpointId,
        '{"secret":"canary"}',
      ),
    ).not.toEqual(fingerprint);
    expect(
      vault.fingerprint(
        context.signingKeyId,
        context.endpointId,
        '{"secret":"canary"}',
      ),
    ).not.toEqual(fingerprint);
    expect(
      vault.fingerprint(
        context.orgId,
        context.signingKeyId,
        '{"secret":"canary"}',
      ),
    ).not.toEqual(fingerprint);
    expect(
      new WebhookVault(ring("current")).fingerprint(
        context.orgId,
        context.endpointId,
        '{"secret":"canary"}',
        fingerprint.keyId,
      ),
    ).toEqual(fingerprint);
    expect(() =>
      vault.fingerprint("invalid", context.endpointId, "{}"),
    ).toThrow(ConnectorVaultUnavailableError);
  });
});
