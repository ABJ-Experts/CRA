jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({})),
}));
jest.mock("./connectors/infrastructure/connector-vault-maintenance", () => ({
  maintainConnectorVault: jest.fn(),
}));
import { createClient } from "@supabase/supabase-js";
import { maintainConnectorVault } from "./connectors/infrastructure/connector-vault-maintenance";
import {
  runChatVaultMaintenance,
  failChatVaultMaintenance,
} from "./chat-vault-maintenance";

const orgId = "10000000-0000-4000-8000-000000000001";
const environment = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "service-secret-canary",
  CONNECTOR_VAULT_KEYRING: JSON.stringify({
    activeKeyId: "active",
    keys: { active: Buffer.alloc(32, 1).toString("base64") },
  }),
};
const report = {
  inspected: 1,
  rewrapped: 0,
  conflicts: 0,
  alreadyCurrent: 1,
  failed: 0,
  dryRun: true,
  keyReferences: { active: 1 },
  missingKeyIds: [],
  retainedKeyReferences: {
    envelopeKeyReferences: { active: 1 },
    commandKeyReferences: {},
    legacyEnvelopeCount: 0,
    hasMoreKeys: false,
  },
};

describe("chat vault maintenance CLI", () => {
  let write: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(maintainConnectorVault).mockResolvedValue(report);
    write = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    process.exitCode = undefined;
  });
  afterEach(() => {
    write.mockRestore();
    process.exitCode = undefined;
  });

  it("defaults to dry run, scopes one tenant and omits credentials from diagnostics", async () => {
    const listeners = process.listenerCount("SIGTERM");
    await runChatVaultMaintenance(["--org", orgId], environment);
    expect(createClient).toHaveBeenCalledWith(
      environment.SUPABASE_URL,
      environment.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    expect(maintainConnectorVault).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ orgId, batchSize: 50, execute: false }),
    );
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("active_ciphertext_before_rotation"),
    );
    expect(
      String((write.mock.calls as readonly (readonly unknown[])[])[0]![0]),
    ).not.toContain("service-secret-canary");
    expect(process.listenerCount("SIGTERM")).toBe(listeners);
    expect(process.exitCode).toBeUndefined();
  });

  it.each(["conflicts", "failed", "missingKeyIds", "hasMoreKeys"])(
    "fails visibly for incomplete rotation: %s",
    async (field) => {
      jest.mocked(maintainConnectorVault).mockResolvedValue({
        ...report,
        ...(field === "hasMoreKeys"
          ? {
              retainedKeyReferences: {
                ...report.retainedKeyReferences,
                hasMoreKeys: true,
              },
            }
          : field === "missingKeyIds"
            ? { missingKeyIds: ["old"] }
            : { [field]: 1 }),
      });
      await runChatVaultMaintenance(["--org", orgId, "--execute"], environment);
      expect(process.exitCode).toBe(1);
    },
  );

  it("cleans up signal handlers after failure and never prints raw errors", async () => {
    const listeners = process.listenerCount("SIGINT");
    jest
      .mocked(maintainConnectorVault)
      .mockImplementation((_store, _vault, options) => {
        process.emit("SIGINT");
        expect(options.signal?.aborted).toBe(true);
        return Promise.reject(new Error("private ciphertext detail"));
      });
    await expect(
      runChatVaultMaintenance(["--org", orgId], environment),
    ).rejects.toThrow("private ciphertext detail");
    expect(process.listenerCount("SIGINT")).toBe(listeners);
    expect(write).not.toHaveBeenCalled();
    const stderr = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      failChatVaultMaintenance();
      expect(stderr).toHaveBeenCalledWith(
        "Chat vault maintenance failed safely. Check configuration and retained recovery keys.\n",
      );
      expect(process.exitCode).toBe(1);
    } finally {
      stderr.mockRestore();
    }
  });

  it("rejects missing vault keys and invalid arguments before creating a client", async () => {
    await expect(runChatVaultMaintenance(["--org", orgId], {})).rejects.toThrow(
      "Chat vault keyring is unavailable",
    );
    await expect(
      runChatVaultMaintenance(
        ["--org", orgId, "--batch-size", "101"],
        environment,
      ),
    ).rejects.toThrow();
    expect(createClient).not.toHaveBeenCalled();
  });
});
