jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({})),
}));
jest.mock("./connectors/infrastructure/connector-vault-maintenance", () => ({
  maintainConnectorVault: jest.fn(),
}));
import { createClient } from "@supabase/supabase-js";
import { maintainConnectorVault } from "./connectors/infrastructure/connector-vault-maintenance";
import {
  failSiemVaultMaintenance,
  runSiemVaultMaintenance,
} from "./siem-vault-maintenance";

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
  inspected: 2,
  rewrapped: 0,
  conflicts: 0,
  alreadyCurrent: 0,
  failed: 0,
  dryRun: true,
  keyReferences: { active: 2 },
  missingKeyIds: [],
  retainedKeyReferences: {
    envelopeKeyReferences: { active: 2 },
    commandKeyReferences: {},
    legacyEnvelopeCount: 0,
    hasMoreKeys: false,
  },
};

describe("siem vault maintenance CLI", () => {
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

  it("defaults to a bounded dry run and prints only key counts and recovery warnings", async () => {
    const listeners = process.listenerCount("SIGTERM");
    await runSiemVaultMaintenance(["--org", orgId], environment);
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
      expect.stringContaining(
        "active_ciphertext_and_immutable_command_fingerprints_before_rotation",
      ),
    );
    expect(
      String((write.mock.calls as readonly (readonly unknown[])[])[0]![0]),
    ).not.toContain("service-secret-canary");
    expect(process.listenerCount("SIGTERM")).toBe(listeners);
    expect(process.exitCode).toBeUndefined();
  });

  it.each(["conflicts", "failed", "missingKeyIds", "hasMoreKeys"])(
    "reports incomplete recovery via failure exit code: %s",
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
            ? { missingKeyIds: ["retained"] }
            : { [field]: 1 }),
      });
      await runSiemVaultMaintenance(
        ["--org", orgId, "--execute", "--batch-size", "1"],
        environment,
      );
      expect(process.exitCode).toBe(1);
    },
  );

  it("removes interruption handlers on failure and propagates cancellation to the bounded loop", async () => {
    const listeners = process.listenerCount("SIGINT");
    jest
      .mocked(maintainConnectorVault)
      .mockImplementation((_store, _vault, options) => {
        process.emit("SIGINT");
        expect(options.signal?.aborted).toBe(true);
        return Promise.reject(new Error("Maintenance interrupted"));
      });
    await expect(
      runSiemVaultMaintenance(["--org", orgId], environment),
    ).rejects.toThrow("interrupted");
    expect(process.listenerCount("SIGINT")).toBe(listeners);
    expect(write).not.toHaveBeenCalled();
  });

  it("reports process failures using a fixed message only", () => {
    const stderr = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      failSiemVaultMaintenance();
      expect(stderr).toHaveBeenCalledWith(
        "Siem vault maintenance failed safely. Check configuration and retained recovery keys.\n",
      );
      expect(process.exitCode).toBe(1);
    } finally {
      stderr.mockRestore();
    }
  });

  it("fails closed before client creation for missing vault configuration or invalid arguments", async () => {
    await expect(runSiemVaultMaintenance(["--org", orgId], {})).rejects.toThrow(
      "Siem vault keyring is unavailable",
    );
    await expect(
      runSiemVaultMaintenance(
        ["--org", orgId, "--batch-size", "101"],
        environment,
      ),
    ).rejects.toThrow();
    await expect(
      runSiemVaultMaintenance(["--org", orgId, "--unexpected"], environment),
    ).rejects.toThrow("Invalid maintenance arguments");
    expect(createClient).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
