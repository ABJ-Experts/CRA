import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, Server } from "node:tls";

import { MailService, RequiredMailDeliveryError } from "./mail.service";

const relayHost = "smtp.customer.test";
const recipient = "owner@cra.test";

function config(port: number, caPath?: string, servername = relayHost) {
  const values: Readonly<Record<string, unknown>> = {
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: port,
    SMTP_TLS_MODE: "tls",
    SMTP_TLS_SERVERNAME: servername,
    SMTP_CA_CERT_PATH: caPath,
    SMTP_FROM: "CRA <no-reply@cra.test>",
    APP_URL: "https://cra.test",
    SMTP_CONNECTION_TIMEOUT_MS: 5000,
    SMTP_GREETING_TIMEOUT_MS: 5000,
    SMTP_SOCKET_TIMEOUT_MS: 5000,
  };
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(`Missing ${key}`);
      return value;
    },
  } as ConfigService;
}

function sendRequired(service: MailService) {
  return service.sendSupportPeriodAlert(
    recipient,
    {
      productName: "Pump",
      supportEndsAt: "2036-02-28T00:00:00.000Z",
      thresholdDays: 30,
      missed: false,
    },
    "relay-tls-test",
  );
}

describe("MailService production TLS relay", () => {
  let fixtureDirectory: string;
  let certificatePath: string;
  let relay: Server;
  let port: number;
  let acceptedMessages = 0;

  beforeAll(async () => {
    fixtureDirectory = mkdtempSync(join(tmpdir(), "cra-smtp-tls-"));
    certificatePath = join(fixtureDirectory, "relay.crt");
    const keyPath = join(fixtureDirectory, "relay.key");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-sha256",
        "-nodes",
        "-days",
        "1",
        "-subj",
        `/CN=${relayHost}`,
        "-addext",
        `subjectAltName=DNS:${relayHost}`,
        "-addext",
        "basicConstraints=critical,CA:TRUE",
        "-keyout",
        keyPath,
        "-out",
        certificatePath,
      ],
      { stdio: "ignore" },
    );

    relay = createServer(
      {
        cert: readFileSync(certificatePath),
        key: readFileSync(keyPath),
      },
      (socket) => {
        let buffer = "";
        let readingData = false;
        socket.setEncoding("utf8");
        socket.setTimeout(5000, () => socket.destroy());
        socket.write(`220 ${relayHost} ESMTP\r\n`);
        socket.on("data", (chunk: string) => {
          buffer += chunk;
          let end = buffer.indexOf("\n");
          while (end !== -1) {
            const line = buffer.slice(0, end).replace(/\r$/, "");
            buffer = buffer.slice(end + 1);
            if (readingData) {
              if (line === ".") {
                readingData = false;
                acceptedMessages += 1;
                socket.write("250 2.0.0 queued as local-1\r\n");
              }
            } else if (/^EHLO\b/i.test(line)) {
              socket.write(`250-${relayHost}\r\n250 SIZE 1048576\r\n`);
            } else if (/^DATA\b/i.test(line)) {
              readingData = true;
              socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
            } else if (/^QUIT\b/i.test(line)) {
              socket.end("221 Bye\r\n");
            } else {
              socket.write("250 OK\r\n");
            }
            end = buffer.indexOf("\n");
          }
        });
      },
    );
    relay.on("tlsClientError", () => undefined);
    await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
    port = (relay.address() as AddressInfo).port;
  }, 15_000);

  afterAll(async () => {
    if (relay?.listening) {
      await new Promise<void>((resolve) => relay.close(() => resolve()));
    }
    if (fixtureDirectory)
      rmSync(fixtureDirectory, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it("rejects an untrusted relay certificate before sending", async () => {
    await expect(sendRequired(new MailService(config(port)))).rejects.toEqual(
      new RequiredMailDeliveryError("delivery_failed"),
    );
    expect(acceptedMessages).toBe(0);
  });

  it("rejects a trusted certificate with the wrong hostname", async () => {
    await expect(
      sendRequired(
        new MailService(config(port, certificatePath, "other.customer.test")),
      ),
    ).rejects.toEqual(new RequiredMailDeliveryError("delivery_failed"));
    expect(acceptedMessages).toBe(0);
  });

  it("accepts a relay only with its CA and matching hostname", async () => {
    const receipt = await sendRequired(
      new MailService(config(port, certificatePath)),
    );
    expect(receipt).toMatchObject({
      status: "provider_accepted",
      acceptedRecipients: [recipient],
      rejectedRecipients: [],
      deliveryConfirmed: false,
    });
    expect(acceptedMessages).toBe(1);
  });
});
