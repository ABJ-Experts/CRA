import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { NativeBackupProcess } from "../capture/native-backup-process";
import { NativeBackupControlTransaction } from "./native-backup-control-transaction";
function processFixture() {
  const control = {
    envelope: '{"outcome":"ok","result":{"version":2}}',
    silent: false,
  };
  const queries: string[] = [];
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const emitter = new EventEmitter();
  const child = Object.assign(emitter, {
    stdout,
    stderr,
    stdin: new Writable({
      write(chunk, _enc, done) {
        const text = String(chunk);
        queries.push(text);
        const marker = text.match(/\\echo ([a-zA-Z0-9_]+)/)?.[1];
        if (marker && !control.silent)
          queueMicrotask(() =>
            stdout.write(
              (text.includes("m15_05_backup_control")
                ? control.envelope + "\n"
                : "") +
                marker +
                "\n",
            ),
          );
        done();
      },
    }),
    kill: jest.fn(() => {
      emitter.emit("close", -1);
      return true;
    }),
  }) as unknown as ChildProcessWithoutNullStreams;
  const process = {
    start: jest.fn(() => child),
    wait: jest.fn(
      () => new Promise<number>((resolve) => emitter.once("close", resolve)),
    ),
  } as unknown as NativeBackupProcess;
  return { process, queries, child, emitter, stdout, control };
}
describe("bounded native backup-control transaction", () => {
  const source = {
    databaseContainer: "source",
    databaseName: "postgres",
    databaseUser: "postgres",
  };
  it("keeps RPC calls on one pinned-role transaction until acknowledged commit", async () => {
    const t = processFixture();
    const session = await NativeBackupControlTransaction.open(
      source,
      t.process,
      new AbortController().signal,
    );
    await expect(
      session.execute(
        "00000000-0000-4000-8000-000000000001",
        "backup-worker:test",
        "cleanup/authorize",
        { value: "apostrophe's" },
      ),
    ).resolves.toEqual({ version: 2 });
    await session.commit();
    expect(t.queries.join("\n")).toContain("transaction_timeout='45s'");
    expect(t.queries.join("\n")).toContain("set local role cra_backup_control");
    expect(t.queries.join("\n")).toContain("apostrophe''s");
    expect(t.queries.at(-1)).toContain("commit;");
    await session.close();
  });
  it("rejects malformed native identities without spawning", async () => {
    const t = processFixture();
    await expect(
      NativeBackupControlTransaction.open(
        { ...source, databaseContainer: "source;rm" },
        t.process,
        new AbortController().signal,
      ),
    ).rejects.toThrow("cleanup_configuration");
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Jest inspects mock calls without invoking the method.
    expect(t.process.start).not.toHaveBeenCalled();
  });
  it("fails closed on native disconnect and bounds output", async () => {
    const t = processFixture();
    const session = await NativeBackupControlTransaction.open(
      source,
      t.process,
      new AbortController().signal,
    );
    const result = session.execute(
      "00000000-0000-4000-8000-000000000001",
      "worker",
      "cleanup/review",
      {},
    );
    t.emitter.emit("close", 1);
    await expect(result).rejects.toThrow("cleanup_transaction_lost");
    await session.close();
  });
  it("rolls back explicitly and refuses reuse", async () => {
    const t = processFixture();
    const session = await NativeBackupControlTransaction.open(
      source,
      t.process,
      new AbortController().signal,
    );
    await session.rollback();
    await expect(
      session.execute(
        "00000000-0000-4000-8000-000000000001",
        "worker",
        "cleanup/review",
        {},
      ),
    ).rejects.toThrow("cleanup_transaction_lost");
    await session.close();
    expect(t.queries.at(-1)).toContain("rollback;");
  });
  it.each([
    ['{"outcome":"blocked"}', "cleanup_blocked"],
    ['{"outcome":"conflict"}', "cleanup_conflict"],
    ["not-json", "cleanup_transaction_result"],
  ])("rejects unsafe control results %s", async (envelope, code) => {
    const t = processFixture();
    const session = await NativeBackupControlTransaction.open(
      source,
      t.process,
      new AbortController().signal,
    );
    t.control.envelope = envelope;
    await expect(
      session.execute(
        "00000000-0000-4000-8000-000000000001",
        "worker",
        "cleanup/review",
        {},
      ),
    ).rejects.toThrow(code);
    await session.close();
  });
  it("bounds all outgoing inputs and rejects concurrent statements", async () => {
    const t = processFixture();
    const session = await NativeBackupControlTransaction.open(
      source,
      t.process,
      new AbortController().signal,
    );
    await expect(
      session.execute("invalid", "worker", "cleanup/review", {}),
    ).rejects.toThrow("cleanup_configuration");
    await expect(
      session.execute(
        "00000000-0000-4000-8000-000000000001",
        "worker",
        "cleanup/review",
        { value: "x".repeat(70000) },
      ),
    ).rejects.toThrow("cleanup_configuration");
    const first = session.execute(
      "00000000-0000-4000-8000-000000000001",
      "worker",
      "cleanup/review",
      {},
    );
    await expect(
      session.execute(
        "00000000-0000-4000-8000-000000000001",
        "worker",
        "cleanup/review",
        {},
      ),
    ).rejects.toThrow("cleanup_transaction_lost");
    await first;
    await session.close();
  });
  it("kills unbounded native output without exposing its contents", async () => {
    const t = processFixture();
    const session = await NativeBackupControlTransaction.open(
      source,
      t.process,
      new AbortController().signal,
    );
    t.control.silent = true;
    const result = session.execute(
      "00000000-0000-4000-8000-000000000001",
      "worker",
      "cleanup/review",
      {},
    );
    t.stdout.write(Buffer.alloc(1024 * 1024 + 1, 120));
    await expect(result).rejects.toThrow("cleanup_transaction_output_limit");
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Jest inspects mock calls without invoking the method.
    expect(t.child.kill).toHaveBeenCalledWith("SIGKILL");
    await session.close();
  });
  it("closes a failed initialization and never reports an open transaction", async () => {
    const t = processFixture();
    t.control.silent = true;
    const result = NativeBackupControlTransaction.open(
      source,
      t.process,
      new AbortController().signal,
    );
    t.emitter.emit("close", 1);
    await expect(result).rejects.toThrow("cleanup_transaction_lost");
  });
});
