import type { SiemSendInput } from "./siem-transport.port";
import { SiemUseCases } from "./siem-use-cases";
const user = {
  id: "actor",
  organizationId: "org",
  role: "owner",
  isActive: true,
} as never;
describe("SIEM application authorization", () => {
  const command = jest.fn().mockResolvedValue({});
  const permissions = jest.fn();
  const repository = { command } as never;
  const service = new SiemUseCases(repository, {
    effectivePermissions: permissions,
  });
  beforeEach(() => {
    command.mockClear();
    permissions.mockReset();
  });
  it("does not disclose or mutate before fresh audit and connector authorization", async () => {
    permissions.mockResolvedValue({ permissions: { can_view_audit: true } });
    await expect(
      service.execute(user, "list", null, { requestId: "request" }),
    ).rejects.toThrow();
    expect(command).not.toHaveBeenCalled();
  });
  it("scopes allowed reads from verified identity", async () => {
    permissions.mockResolvedValue({
      permissions: { can_view_audit: true, can_view_connectors: true },
    });
    await service.execute(user, "list", null, { requestId: "request" });
    expect(command).toHaveBeenCalledWith("org", "actor", "list", null, {
      requestId: "request",
    });
  });
  it("requires export and edit permission for replay", async () => {
    permissions.mockResolvedValue({
      permissions: {
        can_view_audit: true,
        can_view_connectors: true,
        can_edit_connectors: true,
      },
    });
    await expect(
      service.execute(user, "replay", "dest", { requestId: "request" }),
    ).rejects.toThrow();
  });
  it("owner credential actions do not accept admin", async () => {
    permissions.mockResolvedValue({
      permissions: {
        can_view_audit: true,
        can_view_connectors: true,
        can_edit_connectors: true,
        can_export_audit: true,
      },
    });
    await expect(
      service.execute(
        { ...(user as object), role: "admin" } as never,
        "rotate_credentials",
        "dest",
        { requestId: "request" },
      ),
    ).rejects.toThrow();
  });
  it("fails unavailable when fresh permission resolution fails", async () => {
    permissions.mockRejectedValue(new Error("secret provider content"));
    await expect(
      service.execute(user, "list", null, { requestId: "request" }),
    ).rejects.toThrow("SIEM unavailable");
  });
  it("rejects inactive and organizationless identities", async () => {
    await expect(
      service.execute(
        { ...(user as object), isActive: false } as never,
        "list",
        null,
        {},
      ),
    ).rejects.toThrow();
    await expect(
      service.execute(
        { ...(user as object), organizationId: null } as never,
        "list",
        null,
        {},
      ),
    ).rejects.toThrow();
    expect(permissions).not.toHaveBeenCalled();
  });
});

describe("SIEM command encryption and collector validation", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  const command = jest.fn();
  const permissions = {
    effectivePermissions: jest.fn().mockResolvedValue({
      permissions: {
        can_view_audit: true,
        can_view_connectors: true,
        can_create_connectors: true,
        can_edit_connectors: true,
        can_export_audit: true,
      },
    }),
  };
  const vault = {
    available: jest.fn().mockReturnValue(true),
    fingerprint: jest
      .fn()
      .mockReturnValue({ keyId: "key", digest: "a".repeat(64) }),
    encrypt: jest.fn().mockReturnValue({ ciphertext: "encrypted" }),
    decrypt: jest.fn().mockReturnValue({ mode: "bearer", token: "canary" }),
  };
  const transport = {
    validate: jest.fn().mockResolvedValue(undefined),
    send: jest.fn(),
  };
  const service = new SiemUseCases(
    { command },
    permissions,
    vault as never,
    transport,
  );
  beforeEach(() => {
    command.mockReset();
    command.mockResolvedValue({ keyId: null });
    vault.available.mockReturnValue(true);
    transport.send.mockReset();
  });
  it("encrypts before persistence and binds revision to CAS version", async () => {
    await service.execute(user, "rotate_credentials", id, {
      requestId: id,
      expectedVersion: 7,
      credential: { mode: "bearer", token: "canary" },
    });
    const persisted = (
      command.mock.calls.at(-1) as [
        unknown,
        unknown,
        unknown,
        unknown,
        Record<string, unknown>,
      ]
    )[4];
    expect(persisted.credential).toBeUndefined();
    expect(persisted.credentialRevision).toBe(8);
    expect(vault.encrypt).toHaveBeenCalledWith(
      expect.objectContaining({ credentialRevision: 8 }),
      { mode: "bearer", token: "canary" },
    );
  });
  it("reuses historical keyed digest for retries", async () => {
    command.mockResolvedValueOnce({ keyId: "old-key" });
    await service.execute(user, "enable", id, {
      requestId: id,
      expectedVersion: 2,
    });
    expect(vault.fingerprint).toHaveBeenLastCalledWith(
      "org",
      id,
      expect.any(String),
      "old-key",
    );
  });
  it("validates approved endpoints before configuration", async () => {
    await service.execute(user, "create", id, {
      requestId: id,
      destinationId: id,
      transport: "https",
      endpoint: "https://collector.test",
      eventClasses: ["organization"],
      productIds: [],
    });
    expect(transport.validate).toHaveBeenCalledWith(
      "https",
      "https://collector.test",
    );
  });
  it.each(["disable", "revoke_credentials"] as const)(
    "allows %s containment when vault keys are unavailable",
    async (operation) => {
      vault.available.mockReturnValue(false);
      await expect(
        service.execute(user, operation, id, {
          requestId: id,
          expectedVersion: 4,
          reason: "Stop collector",
        }),
      ).resolves.toEqual({ keyId: null });
      expect(command).toHaveBeenCalledWith(
        "org",
        "actor",
        operation,
        id,
        expect.objectContaining({ keyId: null }),
      );
    },
  );
  it.each([true, false])(
    "keeps containment retry criteria stable across vault recovery from %s",
    async (available) => {
      const input = {
        requestId: id,
        expectedVersion: 4,
        reason: "Stop collector",
      };
      vault.available.mockReturnValue(available);
      await service.execute(user, "disable", id, input);
      const first: unknown = command.mock.calls.at(-1);
      vault.available.mockReturnValue(!available);
      await service.execute(user, "disable", id, input);
      expect(command.mock.calls.at(-1)).toEqual(first);
    },
  );
  it("does not mutate when vault unavailable", async () => {
    vault.available.mockReturnValue(false);
    await expect(
      service.execute(user, "enable", id, {
        requestId: id,
        expectedVersion: 1,
      }),
    ).rejects.toThrow("SIEM unavailable");
    expect(command).not.toHaveBeenCalled();
  });
  it("returns versioned static catalogue after durable read receipt", async () => {
    command.mockResolvedValue({ ok: true });
    const response = (await service.execute(user, "catalogue", null, {
      requestId: id,
    })) as { version: number };
    expect(response.version).toBe(1);
  });
  it("does not retain credentials for previews", async () => {
    await service.execute(user, "replay_preview", id, { requestId: id });
    expect(command).toHaveBeenCalledWith("org", "actor", "replay_preview", id, {
      requestId: id,
    });
  });
  const context = {
    organizationId: id,
    destinationId: id,
    credentials: {
      format: "aes-256-gcm-v1",
      keyId: "key",
      ciphertext: "encrypted",
      nonce: "nonce",
      authTag: "tag",
    },
    credentialId: id,
    credentialRevision: 2,
    endpoint: "https://collector.test",
    transport: "https",
    format: "json",
    authorityUserId: id,
  };
  it("sends an isolated structural test and reauthorizes its credential context", async () => {
    command.mockResolvedValueOnce({ keyId: null }).mockResolvedValue(context);
    transport.send.mockImplementation(async (input: SiemSendInput) => {
      expect(await input.beforeSend?.()).toBe(true);
      return { outcome: "accepted", code: null };
    });
    await service.execute(user, "test", id, {
      requestId: id,
      expectedVersion: 2,
    });
    expect(command).toHaveBeenLastCalledWith(
      "org",
      "actor",
      "test",
      id,
      expect.objectContaining({ state: "accepted", safeFailureCode: null }),
    );
  });
  it("fences test sends when credentials changed", async () => {
    command
      .mockResolvedValueOnce({ keyId: null })
      .mockResolvedValueOnce(context)
      .mockResolvedValueOnce({ ...context, credentialRevision: 3 });
    transport.send.mockImplementation(async (input: SiemSendInput) => {
      expect(await input.beforeSend?.()).toBe(false);
      return { outcome: "failed", code: "authorization_revoked" };
    });
    await service.execute(user, "test", id, {
      requestId: id,
      expectedVersion: 2,
    });
  });
});
