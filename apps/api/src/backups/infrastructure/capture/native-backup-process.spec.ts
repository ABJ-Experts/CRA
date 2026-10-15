import { NativeBackupProcess } from "./native-backup-process";

describe("bounded native backup process", () => {
  const native = new NativeBackupProcess();
  it("executes argument vectors and stdin without a shell", async () => {
    await expect(
      native.run(
        process.execPath,
        ["-e", "process.stdin.pipe(process.stdout)"],
        new AbortController().signal,
        "literal $(do-not-execute)",
      ),
    ).resolves.toBe("literal $(do-not-execute)");
  });
  it("bounds stdout and returns fixed errors without stderr", async () => {
    await expect(
      native.run(
        process.execPath,
        ["-e", "process.stdout.write('x'.repeat(100));"],
        new AbortController().signal,
        undefined,
        10,
      ),
    ).rejects.toThrow("native_output_limit");
    await expect(
      native.run(
        process.execPath,
        ["-e", "process.stderr.write('secret');process.exit(2)"],
        new AbortController().signal,
      ),
    ).rejects.toThrow("native_tool_failed");
    await expect(
      native.run("/missing/native-tool", [], new AbortController().signal),
    ).rejects.toThrow("native_tool_unavailable");
  });
  it("refuses cancellation before launch", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      native.run(process.execPath, [], abort.signal),
    ).rejects.toThrow();
  });
  it("observes background completion before delayed cancellation cleanup awaits it", async () => {
    const abort = new AbortController();
    const child = native.start(
      process.execPath,
      ["-e", "setTimeout(()=>{},10000)"],
      abort.signal,
    );
    child.stdout.resume();
    child.stderr.resume();
    child.stdin.end();
    const exited = native.wait(child);
    abort.abort();
    await new Promise((resolve) => setTimeout(resolve, 40));
    await expect(exited).rejects.toThrow("cancelled");
  });
});
