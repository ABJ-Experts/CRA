import { createClient } from "@supabase/supabase-js";
import { main } from "./audit-chain-verify";

jest.mock("@supabase/supabase-js", () => ({ createClient: jest.fn() }));
const organizationId = "11111111-1111-4111-8111-111111111111";
const head = {
  organization_id: organizationId,
  chain_version: 1,
  activation_at: "2026-10-06T00:00:00Z",
  legacy_count: "0",
  last_sequence: "0",
  last_event_id: null,
  last_hash: "0".repeat(64),
  protected_through: null,
  required_retention_days: 0,
  retention_status: "unknown",
  retention_checked_at: null,
  legal_hold: false,
};

describe("audit verifier operator entry point", () => {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let stdout: jest.SpyInstance<
    boolean,
    Parameters<typeof process.stdout.write>
  >;
  let stderr: jest.SpyInstance<
    boolean,
    Parameters<typeof process.stderr.write>
  >;
  const factory = jest.mocked(createClient);
  beforeEach(() => {
    process.argv = [
      "node",
      "audit-chain-verify.js",
      "--organization",
      organizationId,
    ];
    process.exitCode = undefined;
    process.env.SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "private-test-key";
    stdout = jest.spyOn(process.stdout, "write").mockReturnValue(true);
    stderr = jest.spyOn(process.stderr, "write").mockReturnValue(true);
    factory.mockReset();
  });
  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    jest.restoreAllMocks();
  });
  function respond(data: unknown, error: unknown = null): void {
    const rpc = jest.fn().mockResolvedValue({ data, error });
    factory.mockReturnValue({ rpc } as unknown as ReturnType<
      typeof createClient
    >);
  }
  it("prints only checkpoint metadata and disables server session persistence", async () => {
    respond(head);
    await main();
    expect(factory).toHaveBeenCalledWith(
      "http://127.0.0.1:54321",
      "private-test-key",
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
    expect(process.exitCode).toBe(0);
    expect(stderr).not.toHaveBeenCalled();
    const output = String(stdout.mock.calls[0]?.[0]);
    expect(JSON.parse(output)).toMatchObject({
      status: "verified",
      checkpointSequence: "0",
      archivalRequired: true,
    });
    expect(output).not.toContain("private-test-key");
    expect(output).not.toContain("canonical_content");
  });
  it.each(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"])(
    "fails safely without %s",
    async (name) => {
      delete process.env[name];
      await main();
      expect(process.exitCode).toBe(1);
      expect(factory).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalledWith(
        expect.stringContaining("Check explicit organization/range"),
      );
    },
  );
  it("rejects malformed arguments before creating a client", async () => {
    process.argv = [
      "node",
      "audit-chain-verify.js",
      "--organization",
      "forged",
    ];
    await main();
    expect(process.exitCode).toBe(1);
    expect(factory).not.toHaveBeenCalled();
  });
  it("does not disclose provider exception details", async () => {
    factory.mockImplementation(() => {
      throw new Error("private-test-key provider internals");
    });
    await main();
    expect(process.exitCode).toBe(1);
    expect(JSON.stringify(stderr.mock.calls)).not.toContain("private-test-key");
  });
  it.each([
    { data: { ...head, chain_version: 2 }, error: null, status: "corrupt" },
    {
      data: null,
      error: { message: "private-test-key" },
      status: "incomplete",
    },
  ])(
    "exits nonzero for $status verification",
    async ({ data, error, status }) => {
      respond(data, error);
      await main();
      expect(process.exitCode).toBe(1);
      expect(stderr).not.toHaveBeenCalled();
      expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toMatchObject({
        status,
      });
      expect(JSON.stringify(stdout.mock.calls)).not.toContain(
        "private-test-key",
      );
    },
  );
});
