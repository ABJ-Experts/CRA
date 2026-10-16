import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { NativeFlock } from "./native-flock";
import { spawn } from "node:child_process";
jest.mock("node:child_process", () => ({ spawn: jest.fn() }));
describe("native flock lifecycle", () => {
  const original = process.platform;
  afterEach(() => {
    Object.defineProperty(process, "platform", { value: original });
    jest.useRealTimers();
    jest.resetAllMocks();
  });
  function child(mode: "ready" | "exit" | "error" | "bad" | "timeout") {
    Object.defineProperty(process, "platform", { value: "linux" });
    const proc = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      kill: jest.fn(),
    });
    proc.stdin.on("finish", () => proc.emit("close", 0));
    (spawn as jest.Mock).mockImplementation(() => {
      queueMicrotask(() => {
        if (mode === "ready") proc.stdout.emit("data", Buffer.from("ready\n"));
        if (mode === "bad") proc.stdout.emit("data", Buffer.from("other"));
        if (mode === "exit") proc.emit("exit", 1);
        if (mode === "error") proc.emit("error", new Error("unavailable"));
      });
      return proc;
    });
    return proc;
  }
  it("holds until effect completion and releases even on failure", async () => {
    child("ready");
    expect(
      await new NativeFlock().run("/private/lock", () => Promise.resolve(7)),
    ).toBe(7);
    child("ready");
    await expect(
      new NativeFlock().run("/private/lock", () =>
        Promise.reject(new Error("effect")),
      ),
    ).rejects.toThrow("effect");
  });
  it.each(["exit", "error", "bad"] as const)(
    "rejects holder %s",
    async (mode) => {
      child(mode);
      await expect(
        new NativeFlock().run("/private/lock", () => Promise.resolve(7)),
      ).rejects.toThrow();
    },
  );
  it("bounds holder startup", async () => {
    jest.useFakeTimers();
    const proc = child("timeout");
    const result = expect(
      new NativeFlock().run("/private/lock", () => Promise.resolve(7)),
    ).rejects.toThrow("timeout");
    await jest.advanceTimersByTimeAsync(5001);
    await result;
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
  });
  it("rejects unsupported hosts", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    await expect(
      new NativeFlock().run("/private/lock", () => Promise.resolve(7)),
    ).rejects.toThrow("linux");
  });
  it("aborts work and rejects success when holder dies after readiness", async () => {
    const proc = child("ready");
    await expect(
      new NativeFlock().run("/private/lock", async (signal) => {
        proc.emit("exit", 137);
        proc.emit("close", 137);
        await Promise.resolve();
        expect(signal.aborted).toBe(true);
        return "must-not-succeed";
      }),
    ).rejects.toThrow("ownership_lost");
  });
});
