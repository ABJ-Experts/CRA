import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { decryptLegacyConnectorPgp } from "./connector-vault-legacy";

const processFixture = () =>
  Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    status: new PassThrough(),
    passphrase: new PassThrough(),
    kill: jest.fn(),
  });

describe("legacy PGP bridge", () => {
  it("keeps passphrase off arguments and accepts only verified MDC decryption", async () => {
    const child = processFixture();
    const spawn = jest.fn().mockReturnValue(child);
    const result = decryptLegacyConnectorPgp("Y2lwaGVy", "legacy-key", {
      spawn,
    });
    child.stdout.write("canary-plaintext");
    child.status.write("[GNUPG:] GOODMDC\n[GNUPG:] DECRYPTION_OKAY\n");
    child.emit("close", 0);
    await expect(result).resolves.toBe("canary-plaintext");
    expect(JSON.stringify(spawn.mock.calls)).not.toContain("legacy-key");
    expect((spawn.mock.calls[0] as readonly unknown[])[1]).toEqual(
      expect.arrayContaining([
        "--no-keyring",
        "--no-autostart",
        "--no-random-seed-file",
      ]),
    );
    expect((child.passphrase.read() as Buffer).toString()).toBe("legacy-key\n");
    expect((child.stdin.read() as Buffer).toString()).toBe("cipher");
  });

  it.each([
    [1, "[GNUPG:] GOODMDC\n[GNUPG:] DECRYPTION_OKAY\n"],
    [0, "[GNUPG:] DECRYPTION_OKAY\n"],
    [0, "[GNUPG:] BADMDC\n"],
  ])(
    "rejects failures or absent integrity confirmation",
    async (code, status) => {
      const child = processFixture();
      const result = decryptLegacyConnectorPgp("Y2lwaGVy", "legacy-key", {
        spawn: () => child,
      });
      child.stdout.write("canary-plaintext");
      child.status.write(status);
      child.emit("close", code);
      await expect(result).rejects.toThrow(
        "Legacy connector credentials are unavailable",
      );
    },
  );

  it("bounds output, handles spawn failures, timeout and cancellation safely", async () => {
    const child = processFixture();
    const result = decryptLegacyConnectorPgp("Y2lwaGVy", "legacy-key", {
      spawn: () => child,
      maxOutputBytes: 2,
    });
    child.stdout.write("oversized-canary");
    await expect(result).rejects.toThrow(
      "Legacy connector credentials are unavailable",
    );
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    const broken = processFixture();
    const error = decryptLegacyConnectorPgp("Y2lwaGVy", "legacy-key", {
      spawn: () => broken,
    });
    broken.emit("error", new Error("upstream-secret-canary"));
    await expect(error).rejects.toThrow(
      "Legacy connector credentials are unavailable",
    );
    const waiting = processFixture();
    await expect(
      decryptLegacyConnectorPgp("Y2lwaGVy", "legacy-key", {
        spawn: () => waiting,
        timeoutMs: 1,
      }),
    ).rejects.toThrow("Legacy connector credentials are unavailable");
    const abort = new AbortController();
    const interrupted = processFixture();
    const cancellation = decryptLegacyConnectorPgp("Y2lwaGVy", "legacy-key", {
      spawn: () => interrupted,
      signal: abort.signal,
    });
    abort.abort();
    await expect(cancellation).rejects.toThrow(
      "Legacy connector credentials are unavailable",
    );
  });

  it("rejects malformed inputs without starting GPG", async () => {
    const spawn = jest.fn();
    await expect(
      decryptLegacyConnectorPgp("bad", "legacy-key", { spawn }),
    ).rejects.toThrow("Legacy connector credentials are unavailable");
    await expect(
      decryptLegacyConnectorPgp("Y2lwaGVy", "invalid\nkey", { spawn }),
    ).rejects.toThrow("Legacy connector credentials are unavailable");
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      decryptLegacyConnectorPgp("Y2lwaGVy", "legacy-key", {
        spawn,
        signal: aborted.signal,
      }),
    ).rejects.toThrow("Legacy connector credentials are unavailable");
    expect(spawn).not.toHaveBeenCalled();
  });
});
