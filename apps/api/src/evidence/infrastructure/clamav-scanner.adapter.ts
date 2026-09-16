import { Socket } from "node:net";
import type { Readable } from "node:stream";

export type MalwareScanResult = Readonly<
  | { outcome: "clean"; engine: "clamav"; signatureVersion: string | null }
  | { outcome: "infected"; engine: "clamav"; detection: string }
  | { outcome: "unavailable"; engine: "clamav" }
>;

/** Internal-only ClamD INSTREAM client.  It deliberately treats ambiguous
 * responses as unavailable, because pending is safer than granting access. */
export class ClamAvScannerAdapter {
  constructor(private readonly options: Readonly<{ host?: string; port?: number; connectTimeoutMs: number; scanTimeoutMs: number }>) {}

  async scan(stream: Readable): Promise<MalwareScanResult> {
    if (!this.options.host || !this.options.port) return { outcome: "unavailable", engine: "clamav" };
    return new Promise((resolve) => {
      const socket = new Socket();
      const chunks: Buffer[] = [];
      let finished = false;
      const finish = (result: MalwareScanResult) => {
        if (finished) return;
        finished = true;
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(this.options.connectTimeoutMs, () => finish({ outcome: "unavailable", engine: "clamav" }));
      socket.once("error", () => finish({ outcome: "unavailable", engine: "clamav" }));
      socket.connect(this.options.port!, this.options.host!, () => {
        socket.setTimeout(this.options.scanTimeoutMs);
        socket.write("zINSTREAM\0");
        void (async () => {
          try {
            for await (const value of stream) {
              const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
              const length = Buffer.allocUnsafe(4);
              length.writeUInt32BE(chunk.byteLength);
              if (!socket.write(Buffer.concat([length, chunk]))) await onceDrain(socket);
            }
            socket.write(Buffer.alloc(4));
          } catch {
            finish({ outcome: "unavailable", engine: "clamav" });
          }
        })();
      });
      socket.on("data", (value: Buffer) => chunks.push(Buffer.from(value)));
      socket.on("end", () => {
        const response = Buffer.concat(chunks).toString("utf8").trim();
        if (/\bOK$/i.test(response)) finish({ outcome: "clean", engine: "clamav", signatureVersion: null });
        else {
          const match = response.match(/^(.*?):\s*(.*?)\s+FOUND$/i);
          finish(match?.[2] ? { outcome: "infected", engine: "clamav", detection: match[2].slice(0, 200) } : { outcome: "unavailable", engine: "clamav" });
        }
      });
    });
  }
}

function onceDrain(socket: Socket): Promise<void> { return new Promise((resolve) => socket.once("drain", resolve)); }
