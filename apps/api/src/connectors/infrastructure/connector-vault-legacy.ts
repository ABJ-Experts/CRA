import { spawn as nodeSpawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";

export type LegacyGpgProcess = EventEmitter &
  Readonly<{
    stdin: Writable;
    stdout: Readable;
    status: Readable;
    passphrase: Writable;
    kill(signal: "SIGKILL"): unknown;
  }>;

const safeFailure = () =>
  new Error("Legacy connector credentials are unavailable");
const spawnGpg = (
  binary: string,
  args: readonly string[],
): LegacyGpgProcess => {
  const child = nodeSpawn(binary, [...args], {
    stdio: ["pipe", "pipe", "ignore", "pipe", "pipe"],
    shell: false,
  });
  return Object.assign(child, {
    stdin: child.stdin as Writable,
    stdout: child.stdout as Readable,
    status: child.stdio[4] as Readable,
    passphrase: child.stdio[3] as Writable,
  });
};

/** Temporary maintenance bridge. Passphrase uses fd 3; stderr is never retained. */
export async function decryptLegacyConnectorPgp(
  ciphertext: string,
  passphrase: string,
  options: Readonly<{
    binary?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxOutputBytes?: number;
    spawn?: (binary: string, args: readonly string[]) => LegacyGpgProcess;
  }> = {},
): Promise<string> {
  const bytes = Buffer.from(ciphertext, "base64");
  if (
    !bytes.length ||
    bytes.length > 120_000 ||
    bytes.toString("base64") !== ciphertext ||
    !passphrase ||
    /[\r\n]/.test(passphrase) ||
    options.signal?.aborted
  )
    throw safeFailure();
  const binary = options.binary ?? "gpg";
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxOutputBytes = options.maxOutputBytes ?? 80_000;
  if (
    !binary ||
    timeoutMs < 1 ||
    timeoutMs > 60_000 ||
    maxOutputBytes < 1 ||
    maxOutputBytes > 80_000
  )
    throw safeFailure();
  return new Promise((resolve, reject) => {
    let child: LegacyGpgProcess;
    try {
      child = (options.spawn ?? spawnGpg)(binary, [
        "--no-options",
        "--no-keyring",
        "--no-autostart",
        "--no-random-seed-file",
        "--batch",
        "--no-tty",
        "--pinentry-mode",
        "loopback",
        "--no-symkey-cache",
        "--passphrase-fd",
        "3",
        "--status-fd",
        "4",
        "--output",
        "-",
        "--decrypt",
      ]);
    } catch {
      reject(safeFailure());
      return;
    }
    let output: Buffer[] = [];
    let total = 0;
    let status = "";
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", fail);
      for (const buffer of output) buffer.fill(0);
      output = [];
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      cleanup();
      reject(safeFailure());
    };
    const timer = setTimeout(fail, timeoutMs);
    options.signal?.addEventListener("abort", fail, { once: true });
    child.on("error", fail);
    child.stdin.on("error", fail);
    child.passphrase.on("error", fail);
    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxOutputBytes) {
        chunk.fill(0);
        fail();
        return;
      }
      output.push(Buffer.from(chunk));
      chunk.fill(0);
    });
    child.status.on("data", (chunk: Buffer) => {
      if (settled) return;
      status += chunk.toString("utf8");
      if (status.length > 32_000) fail();
    });
    child.on("close", (code: number | null) => {
      if (settled) return;
      if (
        code !== 0 ||
        !/^\[GNUPG:\] GOODMDC\s*$/m.test(status) ||
        !/^\[GNUPG:\] DECRYPTION_OKAY\s*$/m.test(status) ||
        /^\[GNUPG:\] (?:BADMDC|ERROR|FAILURE)/m.test(status)
      ) {
        fail();
        return;
      }
      const plaintext = Buffer.concat(output);
      const secret = plaintext.toString("utf8");
      const valid =
        secret.length > 0 &&
        secret.length <= 20_000 &&
        Buffer.from(secret, "utf8").equals(plaintext);
      plaintext.fill(0);
      if (!valid) {
        fail();
        return;
      }
      settled = true;
      cleanup();
      resolve(secret);
    });
    child.passphrase.end(`${passphrase}\n`);
    child.stdin.end(bytes);
  });
}
