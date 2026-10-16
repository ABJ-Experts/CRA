import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
function setup() {
  const prune = jest.fn().mockResolvedValue(undefined);
  const app = {
    get: jest.fn(() => ({ pruneExpiredNonces: prune })),
    use: jest.fn(),
    setGlobalPrefix: jest.fn(),
    useBodyParser: jest.fn(),
    set: jest.fn(),
    useGlobalFilters: jest.fn(),
    enableShutdownHooks: jest.fn(),
    listen: jest.fn().mockResolvedValue(undefined),
  };
  const stat = jest.fn().mockResolvedValue({ isFile: () => true, mode: 0o600 }),
    readFile = jest
      .fn()
      .mockResolvedValue(Buffer.from("ephemeral TLS fixture")),
    create = jest.fn().mockResolvedValue(app);
  jest.doMock("node:fs/promises", () => ({ stat, readFile }));
  jest.doMock("@nestjs/core", () => ({ NestFactory: { create } }));
  jest.doMock("@nestjs/config", () => ({
    ConfigModule: { forRoot: jest.fn().mockResolvedValue({}) },
  }));
  jest.doMock("@nestjs/common", () => ({
    Logger: class {
      log = jest.fn();
      warn = jest.fn();
    },
  }));
  jest.doMock("./connectors/agent/agent-ingress.module", () => ({
    AgentIngressModule: class {},
  }));
  jest.doMock("./connectors/agent/supabase-agent.repository", () => ({
    SupabaseAgentRepository: class {},
  }));
  jest.doMock("./common/filters/all-exceptions.filter", () => ({
    AllExceptionsFilter: class {},
  }));
  jest.doMock("helmet", () => ({
    __esModule: true,
    default: jest.fn(() => jest.fn()),
  }));
  Object.assign(process.env, {
    AGENT_TLS_KEY_PATH: "/fixture/server.key",
    AGENT_TLS_CERT_PATH: "/fixture/server.pem",
    AGENT_CA_CERT_PATH: "/fixture/ca.pem",
    AGENT_CA_KEY_PATH: "/fixture/ca.key",
    CONNECTOR_VAULT_KEYRING: "test-fixture",
    AGENT_INGRESS_PORT: "3443",
  });
  const module =
    jest.requireActual<typeof import("./agent-main")>("./agent-main");
  return { ...module, prune, app, stat, readFile, create };
}
describe("agent ingress managed bootstrap", () => {
  const original = { ...process.env };
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
  });
  afterEach(() => {
    process.env = { ...original };
    jest.useRealTimers();
    jest.resetModules();
  });
  it("preserves default hourly-only pruning without an initial source mutation", async () => {
    delete process.env.CRA_MAINTENANCE_DIRECTORY;
    const fixture = setup();
    await fixture.bootstrapAgentIngress();
    expect(fixture.prune).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(60 * 60_000);
    expect(fixture.prune).toHaveBeenCalledTimes(1);
    expect(fixture.app.listen).toHaveBeenCalledWith(3443);
  });
  it("proves an initial real managed nonce cycle after listen and waits for its completion", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cra-agent-initial-cycle-"));
    try {
      Object.assign(process.env, {
        CRA_MAINTENANCE_DIRECTORY: directory,
        CRA_MAINTENANCE_ACK_DIRECTORY: directory,
        CRA_SERVICE_ID: "agent-ingress",
        CRA_IMAGE_ID: `sha256:${"a".repeat(64)}`,
      });
      writeFileSync(
        join(directory, "request.json"),
        JSON.stringify({
          version: 1,
          generation: "12345678-1234-4234-8234-123456789abc",
          closed: false,
        }),
      );
      const fixture = setup();
      let finish!: () => void;
      fixture.prune.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      const pending = fixture.bootstrapAgentIngress();
      await jest.advanceTimersByTimeAsync(0);
      expect(fixture.prune).toHaveBeenCalledTimes(1);
      expect(fixture.app.listen.mock.invocationCallOrder[0]).toBeLessThan(
        fixture.prune.mock.invocationCallOrder[0]!,
      );
      expect(
        JSON.parse(readFileSync(join(directory, "live.json"), "utf8")),
      ).toMatchObject({ dependenciesReady: false });
      finish();
      await pending;
      expect(
        JSON.parse(readFileSync(join(directory, "live.json"), "utf8")),
      ).toMatchObject({ dependenciesReady: true, serviceId: "agent-ingress" });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("blocks managed initialization behind a closed gate and retries after reopening", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "cra-agent-closed-bootstrap-"),
    );
    try {
      Object.assign(process.env, {
        CRA_MAINTENANCE_DIRECTORY: directory,
        CRA_MAINTENANCE_ACK_DIRECTORY: directory,
        CRA_SERVICE_ID: "agent-ingress",
        CRA_IMAGE_ID: `sha256:${"a".repeat(64)}`,
      });
      const generation = "12345678-1234-4234-8234-123456789abc";
      writeFileSync(
        join(directory, "request.json"),
        JSON.stringify({ version: 1, generation, closed: true }),
      );
      const fixture = setup();
      const pending = fixture.bootstrapAgentIngress();
      await jest.advanceTimersByTimeAsync(500);
      expect(fixture.create).not.toHaveBeenCalled();
      expect(fixture.prune).not.toHaveBeenCalled();
      writeFileSync(
        join(directory, "request.json"),
        JSON.stringify({ version: 1, generation, closed: false }),
      );
      await jest.advanceTimersByTimeAsync(250);
      await pending;
      expect(fixture.create).toHaveBeenCalledTimes(1);
      expect(fixture.prune).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it.each(["0", "65536", "invalid"])(
    "rejects invalid ingress port %s",
    async (port) => {
      delete process.env.CRA_MAINTENANCE_DIRECTORY;
      const fixture = setup();
      process.env.AGENT_INGRESS_PORT = port;
      await expect(fixture.bootstrapAgentIngress()).rejects.toThrow("TCP port");
      expect(fixture.app.listen).not.toHaveBeenCalled();
    },
  );
  it("rejects missing TLS mount, unsafe key permissions and missing vault keyring", async () => {
    delete process.env.CRA_MAINTENANCE_DIRECTORY;
    const fixture = setup();
    delete process.env.AGENT_TLS_KEY_PATH;
    await expect(fixture.bootstrapAgentIngress()).rejects.toThrow(
      "mounted file",
    );
    process.env.AGENT_TLS_KEY_PATH = "/fixture/server.key";
    fixture.stat.mockResolvedValue({ isFile: () => true, mode: 0o644 });
    await expect(fixture.bootstrapAgentIngress()).rejects.toThrow(
      "accessible only",
    );
    fixture.stat.mockResolvedValue({ isFile: () => false, mode: 0o600 });
    await expect(fixture.bootstrapAgentIngress()).rejects.toThrow(
      "regular file",
    );
    fixture.stat.mockResolvedValue({ isFile: () => true, mode: 0o600 });
    delete process.env.CONNECTOR_VAULT_KEYRING;
    await expect(fixture.bootstrapAgentIngress()).rejects.toThrow(
      "CONNECTOR_VAULT_KEYRING",
    );
    expect(fixture.create).not.toHaveBeenCalled();
  });
});
