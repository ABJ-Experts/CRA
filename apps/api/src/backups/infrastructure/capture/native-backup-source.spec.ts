import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { NativeBackupSourceTools } from "./native-backup-source";
import { NativeBackupProcess } from "./native-backup-process";
import type { BackupSourceMount } from "./backup-mounted-runtime";

class FenceProcess extends NativeBackupProcess {
  mode = "healthy";
  override start(): ChildProcessWithoutNullStreams {
    const emitter = new EventEmitter();
    const child = Object.assign(emitter, {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: () => true,
    }) as unknown as ChildProcessWithoutNullStreams;
    child.stdin.on("data", (input: Buffer) =>
      setImmediate(() => {
        const marker = input.toString().match(/FENCE_CHECK_[a-f0-9]+/)?.[0];
        if (marker && this.mode === "lost") emitter.emit("close", 1);
        else if (marker && this.mode === "silent") return;
        else (child.stdout as PassThrough).write(marker ?? "FENCE_READY\n");
      }),
    );
    child.stdin.on("finish", () =>
      setImmediate(() => emitter.emit("close", 0)),
    );
    return child;
  }
}
describe("native database fence liveness", () => {
  const source = {
    databaseContainer: "fixture",
    databaseUser: "postgres",
  } as BackupSourceMount;
  const deadline = () => new Date(Date.now() + 120000).toISOString();
  it("rechecks the same transaction and reports cancellation without extending authority", async () => {
    const process = new FenceProcess();
    const tools = new NativeBackupSourceTools(process);
    const abort = new AbortController();
    const fence = await tools.acquireFence(
      source,
      "postgres",
      120,
      abort.signal,
      deadline(),
    );
    await fence.verify();
    expect(fence.alive()).toBe(true);
    abort.abort();
    await expect(fence.verify()).rejects.toThrow();
    expect(fence.alive()).toBe(false);
    await fence.release();
  });
  it("fails closed when PostgreSQL has ended the fence while its client is still waiting", async () => {
    const process = new FenceProcess();
    const tools = new NativeBackupSourceTools(process);
    const fence = await tools.acquireFence(
      source,
      "postgres",
      120,
      new AbortController().signal,
      deadline(),
    );
    process.mode = "lost";
    await expect(fence.verify()).rejects.toThrow("write_fence_expired");
    await fence.release();
    await expect(fence.verify()).rejects.toThrow("write_fence_expired");
  });
  it("bounds missing fence acknowledgements and rejects malformed deadlines before starting a client", async () => {
    const process = new FenceProcess();
    const tools = new NativeBackupSourceTools(process);
    await expect(
      tools.acquireFence(
        source,
        "postgres",
        120,
        new AbortController().signal,
        "not-a-deadline",
      ),
    ).rejects.toThrow("write_fence_unavailable");
    const fence = await tools.acquireFence(
      source,
      "postgres",
      120,
      new AbortController().signal,
      deadline(),
    );
    process.mode = "silent";
    await expect(fence.verify()).rejects.toThrow("write_fence_expired");
    await fence.release();
  });
});
