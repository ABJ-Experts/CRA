import { createServer as createHttpsServer } from "node:https";
import { createServer as createTlsServer } from "node:tls";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
/** Owned, disposable test receiver; production transport never permits loopback. */
export async function startSiemCollector() {
  const directory = mkdtempSync(join(tmpdir(), "cra-siem-collector-"));
  const key = join(directory, "key.pem"),
    certificate = join(directory, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      certificate,
      "-days",
      "1",
      "-subj",
      "/CN=collector.example",
      "-addext",
      "subjectAltName=DNS:collector.example",
      "-addext",
      "basicConstraints=critical,CA:TRUE",
    ],
    { stdio: "ignore" },
  );
  const credentials = {
    key: readFileSync(key, "utf8"),
    cert: readFileSync(certificate, "utf8"),
  };
  const received: Buffer[] = [];
  let status = 202;
  let retryAfter: string | undefined;
  const https = createHttpsServer(
    {
      ...credentials,
      ca: credentials.cert,
      requestCert: true,
      rejectUnauthorized: false,
    },
    (req, res) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      req.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 8192) {
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        received.push(Buffer.concat(chunks));
        res.statusCode = status;
        if (retryAfter) res.setHeader("retry-after", retryAfter);
        res.end("receiver-private-canary");
      });
    },
  );
  const syslog = createTlsServer(
    {
      ...credentials,
      ca: credentials.cert,
      requestCert: true,
      rejectUnauthorized: true,
    },
    (socket) => {
      let pending = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        pending = Buffer.concat([pending, chunk]);
        if (pending.byteLength > 16384) {
          socket.destroy();
          return;
        }
        const index = pending.indexOf(32);
        if (index < 1) return;
        const length = Number(pending.subarray(0, index).toString());
        if (!Number.isInteger(length) || length < 1 || length > 10000) {
          socket.destroy();
          return;
        }
        if (pending.length >= index + 1 + length) {
          received.push(pending.subarray(index + 1, index + 1 + length));
          pending = pending.subarray(index + 1 + length);
        }
      });
    },
  );
  await Promise.all([
    new Promise<void>((resolve) => https.listen(0, "127.0.0.1", resolve)),
    new Promise<void>((resolve) => syslog.listen(0, "127.0.0.1", resolve)),
  ]);
  return {
    credential: {
      mode: "mtls" as const,
      certificate: credentials.cert,
      privateKey: credentials.key,
      ca: credentials.cert,
    },
    received,
    httpsPort: (https.address() as AddressInfo).port,
    syslogPort: (syslog.address() as AddressInfo).port,
    setResponse: (next: number, retry?: string) => {
      status = next;
      retryAfter = retry;
    },
    close: async () => {
      await Promise.all([
        new Promise<void>((resolve) => https.close(() => resolve())),
        new Promise<void>((resolve) => syslog.close(() => resolve())),
      ]);
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
