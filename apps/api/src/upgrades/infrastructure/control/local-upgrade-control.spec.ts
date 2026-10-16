import { mkdtemp, chmod, rm, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import { request, createServer } from "node:http";
import { spawn } from "node:child_process";
import { UpgradeControlError } from "../../application/upgrade-supervisor.port";
import {
  createUpgradeControlServer,
  LocalUpgradeControlClient,
  readUpgradeControlKey,
  UpgradeControlTransportError,
} from "./local-upgrade-control";

const instanceId = "11111111-1111-4111-8111-111111111111";
const actor = {
  principalId: "22222222-2222-4222-8222-222222222222",
  fingerprint256: Array(32).fill("AB").join(":"),
  grantRevision: "review-1",
};
describe("independent private upgrade control", () => {
  let root: string;
  let server: Server | undefined;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "cra-upgrade-ipc-"));
    await chmod(root, 0o700);
  });
  afterEach(async () => {
    if (server)
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    await rm(root, { recursive: true, force: true });
  });
  async function start(
    execute = jest.fn().mockResolvedValue({ instanceId, enabled: false }),
  ) {
    const socketPath = join(root, "control.sock");
    server = await createUpgradeControlServer(
      {
        socketPath,
        key: Buffer.alloc(32, 7),
        instanceId,
        lock: {
          run: async (_path, effect) => effect(new AbortController().signal),
        },
      },
      { execute },
    );
    return {
      client: new LocalUpgradeControlClient({
        socketPath,
        key: Buffer.alloc(32, 7),
        instanceId,
      }),
      execute,
      socketPath,
    };
  }
  it("authenticates a bounded local request and response without changing the actor", async () => {
    const { client, execute } = await start();
    await expect(
      client.execute(instanceId, actor, "capabilities/read"),
    ).resolves.toEqual({ instanceId, enabled: false });
    expect(execute).toHaveBeenCalledWith(
      instanceId,
      actor,
      "capabilities/read",
      undefined,
      expect.any(AbortSignal),
    );
  });
  it("does not dispatch unauthenticated traffic or accept another instance", async () => {
    const { client, execute, socketPath } = await start();
    await expect(
      client.execute(
        "33333333-3333-4333-8333-333333333333",
        actor,
        "capabilities/read",
      ),
    ).rejects.toThrow();
    const status = await new Promise<number>((resolve, reject) => {
      const call = request(
        {
          socketPath,
          path: "/execute",
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode!);
        },
      );
      call.on("error", reject);
      call.end(JSON.stringify({ actor, action: "run/apply" }));
    });
    expect(status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });
  it("never exposes an executor exception through the control boundary", async () => {
    const { client } = await start(
      jest
        .fn()
        .mockRejectedValue(new Error("private source password and host path")),
    );
    await expect(client.execute(instanceId, actor, "run/list")).rejects.toThrow(
      "Upgrade control unavailable",
    );
  });
  it("preserves the default unavailable application status across authenticated IPC", async () => {
    const { client } = await start(
      jest.fn().mockRejectedValue(new UpgradeControlError()),
    );
    await expect(
      client.execute(instanceId, actor, "run/list"),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("rejects a wrong shared key before invoking privileged control", async () => {
    const { execute, socketPath } = await start();
    const client = new LocalUpgradeControlClient({
      socketPath,
      key: Buffer.alloc(32, 8),
      instanceId,
    });
    await expect(
      client.execute(instanceId, actor, "run/list"),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it("requires a private socket directory and a sufficiently long key", async () => {
    await chmod(root, 0o755);
    await expect(
      createUpgradeControlServer(
        {
          socketPath: join(root, "unsafe.sock"),
          key: Buffer.alloc(32),
          instanceId,
        },
        { execute: jest.fn() },
      ),
    ).rejects.toThrow();
    expect(
      () =>
        new LocalUpgradeControlClient({
          socketPath: join(root, "x"),
          key: Buffer.alloc(8),
          instanceId,
        }),
    ).toThrow();
  });
  it("recovers only an owned stale socket after abrupt process termination", async () => {
    const socketPath = join(root, "control.sock");
    const child = spawn(
      process.execPath,
      [
        "-e",
        "require('node:net').createServer().listen(process.argv[1],()=>{require('node:fs').chmodSync(process.argv[1],0o600);process.send('ready')});",
        socketPath,
      ],
      { stdio: ["ignore", "ignore", "ignore", "ipc"] },
    );
    await new Promise<void>((resolve, reject) => {
      child.once("message", () => resolve());
      child.once("error", reject);
    });
    const exited = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    );
    child.kill("SIGKILL");
    await exited;
    const { client } = await start();
    await expect(
      client.execute(instanceId, actor, "run/list"),
    ).resolves.toEqual({ instanceId, enabled: false });
  });
  it("preserves authenticated conflict and forbidden outcomes", async () => {
    const execute = jest
      .fn()
      .mockRejectedValue(new UpgradeControlTransportError(409));
    const { client } = await start(execute);
    await expect(
      client.execute(instanceId, actor, "run/apply"),
    ).rejects.toMatchObject({ status: 409 });
    execute.mockRejectedValue(new UpgradeControlTransportError(403));
    await expect(
      client.execute(instanceId, actor, "run/list"),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("reads only bounded private regular key files without following links", async () => {
    const path = join(root, "control.key");
    await writeFile(path, Buffer.alloc(32, 1), { mode: 0o600 });
    await expect(readUpgradeControlKey(path)).resolves.toEqual(
      Buffer.alloc(32, 1),
    );
    await chmod(path, 0o644);
    await expect(readUpgradeControlKey(path)).rejects.toThrow();
    await chmod(path, 0o600);
    await writeFile(path, "small");
    await expect(readUpgradeControlKey(path)).rejects.toThrow();
    await symlink(path, join(root, "link.key"));
    await expect(
      readUpgradeControlKey(join(root, "link.key")),
    ).rejects.toThrow();
  });
  it("never replaces a live socket or an ordinary filesystem entry", async () => {
    const { socketPath, client } = await start();
    await expect(
      createUpgradeControlServer(
        {
          socketPath,
          key: Buffer.alloc(32),
          instanceId,
          lock: {
            run: async (_path, effect) => effect(new AbortController().signal),
          },
        },
        { execute: jest.fn() },
      ),
    ).rejects.toThrow();
    await expect(
      client.execute(instanceId, actor, "run/list"),
    ).resolves.toBeDefined();
    const regularPath = join(root, "ordinary");
    await writeFile(regularPath, "preserve", { mode: 0o600 });
    await expect(
      createUpgradeControlServer(
        {
          socketPath: regularPath,
          key: Buffer.alloc(32),
          instanceId,
          lock: {
            run: async (_path, effect) => effect(new AbortController().signal),
          },
        },
        { execute: jest.fn() },
      ),
    ).rejects.toThrow();
  });
  it("closes the listener if startup lock authority is lost after binding", async () => {
    const socketPath = join(root, "lost-startup.sock");
    const execute = jest.fn().mockResolvedValue({ enabled: false });
    await expect(
      createUpgradeControlServer(
        {
          socketPath,
          key: Buffer.alloc(32, 7),
          instanceId,
          lock: {
            run: async (_path, effect) => {
              const abort = new AbortController();
              await effect(abort.signal);
              abort.abort();
              throw new Error("startup lock lost");
            },
          },
        },
        { execute },
      ),
    ).rejects.toThrow();
    const client = new LocalUpgradeControlClient({
      socketPath,
      key: Buffer.alloc(32, 7),
      instanceId,
    });
    await expect(
      client.execute(instanceId, actor, "capabilities/read"),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects over-limit commands and authenticated requests bound to another instance", async () => {
    const { client, execute, socketPath } = await start();
    await expect(
      client.execute(instanceId, actor, "run/apply", {
        data: "x".repeat(33 * 1024),
      }),
    ).rejects.toThrow();
    const other = new LocalUpgradeControlClient({
      socketPath,
      key: Buffer.alloc(32, 7),
      instanceId: "33333333-3333-4333-8333-333333333333",
    });
    await expect(
      other.execute("33333333-3333-4333-8333-333333333333", actor, "run/list"),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects forged responses instead of accepting unsigned executor state", async () => {
    const socketPath = join(root, "forged.sock");
    server = createServer((incoming, response) => {
      let body = "";
      incoming.on("data", (chunk) => {
        body += chunk;
      });
      incoming.on("end", () => {
        const requestId = (JSON.parse(body) as { requestId: string }).requestId;
        response.end(
          JSON.stringify({
            requestId,
            ok: true,
            status: 200,
            value: {},
            mac: "0".repeat(64),
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server!.listen(socketPath, resolve));
    const client = new LocalUpgradeControlClient({
      socketPath,
      key: Buffer.alloc(32, 7),
      instanceId,
    });
    await expect(client.execute(instanceId, actor, "run/list")).rejects.toThrow(
      "Upgrade control unavailable",
    );
  });
});
