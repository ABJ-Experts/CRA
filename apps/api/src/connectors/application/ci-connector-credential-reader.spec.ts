import { CiConnectorCredentialReader } from "./ci-connector-credential-reader";

const orgId = "00000000-0000-4000-8000-000000000001";
const connectorId = "00000000-0000-4000-8000-000000000002";
const context = {
  connector: {
    id: connectorId,
    organizationId: orgId,
    connectorType: "github_actions",
    connectionConfig: {
      providerHost: "github.com",
      appId: "123",
      installationId: "456",
    },
    enabled: true,
    archivedAt: null,
    hasSecret: true,
  },
  connectionRevision: 3,
  credentialRevision: 2,
  secret: {
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
  },
};

describe("CiConnectorCredentialReader", () => {
  function fixture() {
    const repository = { context: jest.fn().mockResolvedValue(context) };
    const reader = { read: jest.fn().mockResolvedValue("vault-only-secret") };
    const egress = { validate: jest.fn().mockResolvedValue(undefined) };
    const service = new CiConnectorCredentialReader(repository, reader, egress);
    return { repository, reader, egress, service };
  }

  it("loads tenant-scoped metadata and decrypts only inside the API process", async () => {
    const f = fixture();
    await expect(f.service.load(orgId, connectorId)).resolves.toMatchObject({
      connectorId,
      provider: "github_actions",
      secret: "vault-only-secret",
      credentialRevision: 2,
      config: context.connector.connectionConfig,
    });
    expect(f.repository.context).toHaveBeenCalledWith(orgId, connectorId);
    expect(f.reader.read).toHaveBeenCalledWith(
      {
        orgId,
        connectorId,
        secretId: context.secret.secretId,
        credentialRevision: 2,
      },
      context.secret,
    );
  });

  it.each([
    { enabled: false },
    { archivedAt: "2026-09-30T00:00:00Z" },
    { hasSecret: false },
  ])(
    "rejects inactive or uncredentialed connections (%p)",
    async (override) => {
      const f = fixture();
      f.repository.context.mockResolvedValue({
        ...context,
        connector: { ...context.connector, ...override },
      });
      await expect(f.service.load(orgId, connectorId)).rejects.toMatchObject({
        code: "invalid_state",
      });
      expect(f.reader.read).not.toHaveBeenCalled();
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

  it("rejects cross-tenant context even if a repository adapter returns a row", async () => {
    const f = fixture();
    f.repository.context.mockResolvedValue({
      ...context,
      connector: {
        ...context.connector,
        organizationId: "00000000-0000-4000-8000-000000000099",
      },
    });
    await expect(f.service.load(orgId, connectorId)).rejects.toMatchObject({
      code: "invalid_state",
    });
    expect(f.reader.read).not.toHaveBeenCalled();
  });

  it.each([
    ["gitlab_ci", { providerHost: "gitlab.example.com", projectId: "42" }],
    [
      "azure_devops",
      {
        providerHost: "dev.azure.com",
        organization: "acme",
        projectId: connectorId,
        serviceConnectionId: connectorId,
      },
    ],
  ] as const)(
    "loads %s config through the same guarded vault path",
    async (provider, config) => {
      const f = fixture();
      f.repository.context.mockResolvedValue({
        ...context,
        connector: {
          ...context.connector,
          connectorType: provider,
          connectionConfig: config,
        },
      });
      await expect(f.service.load(orgId, connectorId)).resolves.toMatchObject({
        provider,
        config,
        secret: "vault-only-secret",
      });
      expect(f.egress.validate).toHaveBeenCalledWith(config, provider);
    },
  );
});
