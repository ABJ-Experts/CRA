import { JiraConnectorCredentialReader } from "./jira-connector-credential-reader";

const orgId = "00000000-0000-4000-8000-000000000001";
const connectorId = "00000000-0000-4000-8000-000000000002";
const cloudId = "00000000-0000-4000-8000-000000000004";
const token = "jira-service-account-token";
const webhookSecret = "12345678901234567890123456789012";
const secret = {
  secretId: "00000000-0000-4000-8000-000000000003",
  credentialRevision: 2,
  envelope: {
    format: "aes-256-gcm-v1",
    keyId: "key",
    nonce: "n",
    authTag: "a",
    ciphertext: "c",
  },
  legacy: false,
} as const;
const context = {
  connector: {
    id: connectorId,
    organizationId: orgId,
    connectorType: "jira",
    connectionConfig: {
      providerHost: "api.atlassian.com",
      siteHost: "tenant.atlassian.net",
      cloudId,
    },
    enabled: true,
    archivedAt: null,
    hasSecret: true,
  },
  connectionRevision: 3,
  credentialRevision: 2,
  secret,
} as const;

describe("JiraConnectorCredentialReader", () => {
  function fixture() {
    const repository = { context: jest.fn().mockResolvedValue(context) };
    const reader = {
      read: jest
        .fn()
        .mockResolvedValue(JSON.stringify({ token, webhookSecret })),
    };
    const egress = { validate: jest.fn().mockResolvedValue(undefined) };
    const service = new JiraConnectorCredentialReader(
      repository,
      reader,
      egress,
    );
    return { repository, reader, egress, service };
  }

  it("loads tenant-scoped Jira metadata and decrypts only inside the API process", async () => {
    const f = fixture();
    await expect(f.service.load(orgId, connectorId)).resolves.toMatchObject({
      connectorId,
      provider: "jira",
      token,
      webhookSecret,
      credentialRevision: 2,
      connectionRevision: 3,
      config: context.connector.connectionConfig,
    });
    expect(f.repository.context).toHaveBeenCalledWith(orgId, connectorId);
    expect(f.egress.validate).toHaveBeenCalledWith(
      context.connector.connectionConfig,
      "jira",
    );
    expect(f.reader.read).toHaveBeenCalledWith(
      {
        orgId,
        connectorId,
        secretId: secret.secretId,
        credentialRevision: 2,
      },
      secret,
    );
  });

  it.each([
    { connectorType: "github_actions" },
    { enabled: false },
    { archivedAt: "2026-09-30T00:00:00Z" },
    { hasSecret: false },
    { organizationId: "00000000-0000-4000-8000-000000000099" },
    {},
  ])(
    "rejects non-Jira, inactive or cross-tenant rows (%p)",
    async (override) => {
      const f = fixture();
      f.repository.context.mockResolvedValue({
        ...context,
        connector: { ...context.connector, ...override },
        secret: Object.keys(override).length === 0 ? null : context.secret,
      });
      await expect(f.service.load(orgId, connectorId)).rejects.toMatchObject({
        code: "invalid_state",
      });
      expect(f.reader.read).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["legacy plaintext", "jira-service-account-token", { legacy: true }],
    ["malformed JSON", "jira-service-account-token", {}],
    ["missing webhook secret", JSON.stringify({ token }), {}],
    [
      "short webhook secret",
      JSON.stringify({ token, webhookSecret: "too-short" }),
      {},
    ],
    [
      "extra keys",
      JSON.stringify({ token, webhookSecret, password: "injected" }),
      {},
    ],
  ])(
    "rejects %s credential bundles",
    async (_name, payload, secretOverride) => {
      const f = fixture();
      f.reader.read.mockResolvedValue(payload);
      f.repository.context.mockResolvedValue({
        ...context,
        secret: { ...context.secret, ...secretOverride },
      });
      await expect(f.service.load(orgId, connectorId)).rejects.toMatchObject({
        code: "invalid_state",
      });
    },
  );

  it("rejects invalid provider metadata and never opens the vault", async () => {
    const f = fixture();
    f.repository.context.mockResolvedValue({
      ...context,
      connector: {
        ...context.connector,
        connectionConfig: {
          ...context.connector.connectionConfig,
          token: "injected",
        },
      },
    });
    await expect(f.service.load(orgId, connectorId)).rejects.toMatchObject({
      code: "invalid_state",
    });
    expect(f.reader.read).not.toHaveBeenCalled();
  });

  it("rejects a stale credential revision before decrypting", async () => {
    const f = fixture();
    f.repository.context.mockResolvedValue({
      ...context,
      credentialRevision: 3,
    });
    await expect(f.service.load(orgId, connectorId)).rejects.toMatchObject({
      code: "invalid_state",
    });
    expect(f.reader.read).not.toHaveBeenCalled();
  });
});
