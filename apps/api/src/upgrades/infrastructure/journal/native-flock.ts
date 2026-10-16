import { spawn } from "node:child_process";
export interface UpgradeJournalLock {
  run<T>(path: string, effect: (signal: AbortSignal) => Promise<T>): Promise<T>;
}
const HOLDER =
  'process.stdout.write("ready\\n");process.stdin.resume();process.stdin.on("end",()=>process.exit(0));';
/** The kernel releases this lock when the holder dies; no time-based stealing. */
export class NativeFlock implements UpgradeJournalLock {
  async run<T>(
    path: string,
    effect: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (process.platform !== "linux") throw new Error("upgrade_linux_required");
    const child = spawn(
      "/usr/bin/flock",
      ["--exclusive", "--nonblock", path, process.execPath, "-e", HOLDER],
      { stdio: ["pipe", "pipe", "ignore"], env: { PATH: "/usr/bin:/bin" } },
    );
    const controller = new AbortController();
    let releasing = false;
    child.on("exit", () => {
      if (!releasing)
        controller.abort(new Error("upgrade_journal_ownership_lost"));
    });
    child.on("error", () => {
      if (!releasing)
        controller.abort(new Error("upgrade_journal_ownership_lost"));
    });
    const closed = new Promise<void>((resolve) =>
      child.once("close", () => resolve()),
    );
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("upgrade_journal_lock_timeout"));
        }, 5000);
        const finish = (error?: Error) => {
          clearTimeout(timer);
          if (error) reject(error);
          else resolve();
        };
        child.once("error", () =>
          finish(new Error("upgrade_journal_lock_unavailable")),
        );
        child.once("exit", () => finish(new Error("upgrade_journal_locked")));
        child.stdout.once("data", (bytes: Buffer) => {
          if (bytes.toString() !== "ready\n")
            finish(new Error("upgrade_journal_lock_unavailable"));
          else finish();
        });
      });
      controller.signal.throwIfAborted();
      const result = await effect(controller.signal);
      controller.signal.throwIfAborted();
      return result;
    } finally {
      releasing = true;
      child.stdin.end();
      await closed;
    }
  }
}
