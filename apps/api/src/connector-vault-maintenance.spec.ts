import { createClient } from "@supabase/supabase-js";
import {
  parseConnectorVaultMaintenanceArguments,
  runConnectorVaultMaintenance,
} from "./connector-vault-maintenance";
import { maintainConnectorVault } from "./connectors/infrastructure/connector-vault-maintenance";
import { decryptLegacyConnectorPgp } from "./connectors/infrastructure/connector-vault-legacy";

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn().mockReturnValue({ rpc: jest.fn() }),
}));
jest.mock("./connectors/infrastructure/connector-vault-maintenance", () => ({
  maintainConnectorVault: jest.fn(),
}));
jest.mock("./connectors/infrastructure/connector-vault-legacy", () => ({
  decryptLegacyConnectorPgp: jest.fn().mockResolvedValue("temporary-secret"),
}));
const org = "00000000-0000-4000-8000-000000000001";
const environment = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  CONNECTOR_VAULT_KEYRING: JSON.stringify({
    activeKeyId: "key",
    keys: { key: Buffer.alloc(32, 1).toString("base64") },
  }),
};

describe("connector vault maintenance CLI", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = 0;
  });
  it("requires one tenant and defaults to dry run with a bounded page", () => {
    expect(parseConnectorVaultMaintenanceArguments(["--org", org])).toEqual({
      orgId: org,
      batchSize: 50,
      execute: false,
    });
    expect(
      parseConnectorVaultMaintenanceArguments([
        "--execute",
        "--org",
        org,
        "--batch-size",
        "100",
      ]),
    ).toEqual({ orgId: org, batchSize: 100, execute: true });
    for (const args of [
      [],
      ["--org", "invalid"],
      ["--org", org, "--org", org],
      ["--org", org, "--batch-size", "101"],
      ["--org", org, "--batch-size"],
      ["--org", org, "--reset"],
      ["--org=" + org],
      ["--org", org, "unexpected"],
    ])
      expect(() => parseConnectorVaultMaintenanceArguments(args)).toThrow();
  });
  it("keeps data unavailable if key material is missing and prints no raw failures", async () => {
    await expect(
      runConnectorVaultMaintenance(["--org", org], {}),
    ).rejects.toThrow("Connector vault keyring is unavailable");
    await expect(
      runConnectorVaultMaintenance(["--org", org], {
        ...environment,
        SUPABASE_URL: undefined,
      }),
    ).rejects.toThrow();
  });
  it("prints safe counts, uses a nonpersistent service client and clears signal handlers", async () => {
    const output = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const listeners = process.listenerCount("SIGINT");
    (maintainConnectorVault as jest.Mock).mockResolvedValue({
      inspected: 0,
      rewrapped: 0,
      conflicts: 0,
      failed: 0,
      keyReferences: {},
      missingKeyIds: [],
      retainedKeyReferences: { hasMoreKeys: false },
    });
    await runConnectorVaultMaintenance(["--org", org], environment);
    expect(output.mock.calls[0]?.[0]).not.toContain("service-key");
    expect(output.mock.calls[0]?.[0]).toContain(
      "Retain keys referenced by command fingerprints and backups",
    );
    expect(createClient).toHaveBeenCalledWith(
      environment.SUPABASE_URL,
      "service-key",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    expect(process.listenerCount("SIGINT")).toBe(listeners);
  });
  it("forwards legacy recovery only via memory and records residual failures", async () => {
    jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    (maintainConnectorVault as jest.Mock).mockImplementation(
      async (
        _store: unknown,
        _vault: unknown,
        options: Parameters<typeof maintainConnectorVault>[2],
        decryptLegacy: NonNullable<
          Parameters<typeof maintainConnectorVault>[3]
        >,
      ) => {
        process.emit("SIGINT");
        expect(options.signal!.aborted).toBe(true);
        expect(await decryptLegacy("ciphertext")).toBe("temporary-secret");
        return {
          failed: 1,
          conflicts: 0,
          missingKeyIds: [],
          retainedKeyReferences: { hasMoreKeys: false },
        };
      },
    );
    await runConnectorVaultMaintenance(["--org", org, "--execute"], {
      ...environment,
      CONNECTOR_SECRET_ENCRYPTION_KEY: "recovery-key",
      CONNECTOR_VAULT_GPG_BINARY: "/opt/homebrew/bin/gpg",
    });
    expect(decryptLegacyConnectorPgp).toHaveBeenCalledWith(
      "ciphertext",
      "recovery-key",
      expect.objectContaining({ binary: "/opt/homebrew/bin/gpg" }),
    );
    expect(process.exitCode).toBe(1);
  });
  it("returns nonzero readiness status when retained key inventory is incomplete", async () => {
    jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    (maintainConnectorVault as jest.Mock).mockResolvedValue({
      failed: 0,
      conflicts: 0,
      missingKeyIds: ["missing"],
      retainedKeyReferences: { hasMoreKeys: false },
    });
    await runConnectorVaultMaintenance(["--org", org], environment);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    (maintainConnectorVault as jest.Mock).mockResolvedValue({
      failed: 0,
      conflicts: 0,
      missingKeyIds: [],
      retainedKeyReferences: { hasMoreKeys: true },
    });
    await runConnectorVaultMaintenance(["--org", org], environment);
    expect(process.exitCode).toBe(1);
  });
});
