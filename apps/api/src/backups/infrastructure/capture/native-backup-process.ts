import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { BackupExecutionError } from "../../application/backup-execution.port";

/** No shell interpolation, secret argv, or native stderr is exposed. */
export class NativeBackupProcess {
  start(
    binary: string,
    args: readonly string[],
    signal?: AbortSignal,
  ): ChildProcessWithoutNullStreams {
    return spawn(binary, [...args], {
      stdio: ["pipe", "pipe", "pipe"],
      signal,
    });
  }

  async run(
    binary: string,
    args: readonly string[],
    signal: AbortSignal,
    input?: string,
    maximumOutput = 16 * 1024 * 1024,
  ): Promise<string> {
    signal.throwIfAborted();
    const child = this.start(binary, args, signal);
    let output = "";
    let oversized = false;
    child.stdout.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(output) + chunk.length > maximumOutput) {
        oversized = true;
        child.kill("SIGKILL");
        return;
      }
      output += chunk.toString("utf8");
    });
    child.stderr.resume();
    const done = this.wait(child);
    child.stdin.end(input);
    const code = await done;
    if (oversized) throw new BackupExecutionError("native_output_limit");
    if (code !== 0)
      throw new BackupExecutionError(
        signal.aborted ? "cancelled" : "native_tool_failed",
      );
    return output.trim();
  }

  wait(child: ChildProcessWithoutNullStreams): Promise<number> {
    const completion = new Promise<number>((resolve, reject) => {
      child.once("error", (error: NodeJS.ErrnoException) =>
        reject(
          new BackupExecutionError(
            error.name === "AbortError"
              ? "cancelled"
              : "native_tool_unavailable",
          ),
        ),
      );
      child.once("close", (code) => resolve(code ?? -1));
    });
    // Long-running receivers/fences are awaited during cleanup. Observe errors
    // immediately while retaining rejection for that later authoritative await.
    void completion.catch(() => undefined);
    return completion;
  }
}
