import { generateKeyPairSync } from "node:crypto";
import { NodeSiemTransport } from "./node-siem-transport";
import { SiemVault } from "./siem-vault";
import { AesGcmConnectorVault } from "../../../connectors/infrastructure/connector-vault";
import { startSiemCollector } from "../../../../test/fixtures/siem-collector";
// Only the test socket factory maps the approved public target to owned loopback.
jest.mock("node:https", () => {
  const actual = jest.requireActual<typeof import("node:https")>("node:https");
  return {
    ...actual,
    request: (
      options: import("node:https").RequestOptions,
      cb: (res: import("node:http").IncomingMessage) => void,
    ) =>
      actual.request(
        {
          ...options,
          lookup: (
            _h: string,
            _o: unknown,
            done: (error: null, address: string, family: number) => void,
          ) => done(null, "127.0.0.1", 4),
        },
        cb,
      ),
  };
});
jest.mock("node:tls", () => {
  const actual = jest.requireActual<typeof import("node:tls")>("node:tls");
  return {
    ...actual,
    connect: (options: import("node:tls").ConnectionOptions, cb: () => void) =>
      actual.connect({ ...options, host: "127.0.0.1" }, cb),
  };
});
describe("controlled TLS collector verification", () => {
  let fixture: Awaited<ReturnType<typeof startSiemCollector>>;
  beforeAll(async () => {
    fixture = await startSiemCollector();
  });
  afterAll(async () => {
    await fixture.close();
  });
  it.each([
    ["https", "json"],
    ["https", "cef"],
    ["syslog_tls", "json"],
    ["syslog_tls", "cef"],
  ] as const)(
    "delivers %s/%s with authenticated TLS",
    async (protocol, format) => {
      const port =
        protocol === "https" ? fixture.httpsPort : fixture.syslogPort;
      const transport = new NodeSiemTransport(
        [{ protocol, hostname: "collector.example", port }],
        () => Promise.resolve([{ address: "93.184.216.34" }]),
      );
      const body = Buffer.from(
        format === "json"
          ? '{"eventId":"stable-id","value":"é"}'
          : "CEF:0|ABJ Experts|CRA Sentinel|1|action|Action|5|externalId=stable-id",
      );
      const result = await transport.send({
        protocol,
        format,
        endpoint: `${protocol === "https" ? "https" : "tls"}://collector.example:${port}`,
        body,
        eventId: "stable-id",
        credential: fixture.credential,
      });
      expect(result.outcome).toBe(
        protocol === "https" ? "accepted" : "sent_unacknowledged",
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fixture.received.some((bytes) => bytes.includes(body))).toBe(true);
    },
  );
  it("captures outage/rate-limit classification without consuming collector canary", async () => {
    fixture.setResponse(429, "20");
    const transport = new NodeSiemTransport(
      [
        {
          protocol: "https",
          hostname: "collector.example",
          port: fixture.httpsPort,
        },
      ],
      () => Promise.resolve([{ address: "93.184.216.34" }]),
    );
    const result = await transport.send({
      protocol: "https",
      format: "json",
      endpoint: `https://collector.example:${fixture.httpsPort}`,
      body: Buffer.from("{}"),
      eventId: "stable-id",
      credential: fixture.credential,
    });
    expect(result).toMatchObject({ code: "http_429", retryAfterSeconds: 20 });
    expect(JSON.stringify(result)).not.toContain("receiver-private-canary");
    fixture.setResponse(202);
  });
  it("validates and binds a real certificate bundle", () => {
    const vault = new SiemVault(
      new AesGcmConnectorVault(
        JSON.stringify({
          activeKeyId: "one",
          keys: { one: Buffer.alloc(32, 1).toString("base64") },
        }),
      ),
    );
    const context = {
      orgId: "10000000-0000-4000-8000-000000000001",
      destinationId: "10000000-0000-4000-8000-000000000002",
      credentialId: "10000000-0000-4000-8000-000000000003",
      credentialRevision: 1,
    };
    const envelope = vault.encrypt(context, fixture.credential);
    expect(vault.decrypt(context, envelope)).toEqual(fixture.credential);
  });
});

it("rejects certificate/private key substitution and noncertificate trust material", async () => {
  const fixture = await startSiemCollector();
  try {
    const vault = new SiemVault(
      new AesGcmConnectorVault(
        JSON.stringify({
          activeKeyId: "one",
          keys: { one: Buffer.alloc(32, 1).toString("base64") },
        }),
      ),
    );
    const context = {
      orgId: "10000000-0000-4000-8000-000000000001",
      destinationId: "10000000-0000-4000-8000-000000000002",
      credentialId: "10000000-0000-4000-8000-000000000003",
      credentialRevision: 1,
    };
    const wrongKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    expect(() =>
      vault.encrypt(context, { ...fixture.credential, privateKey: wrongKey }),
    ).toThrow();
    expect(() =>
      vault.encrypt(context, {
        ...fixture.credential,
        ca: fixture.credential.privateKey,
      }),
    ).toThrow();
    const credential = { ...fixture.credential, ca: undefined };
    expect(
      vault.decrypt(context, vault.encrypt(context, credential)),
    ).toMatchObject({ mode: "mtls" });
  } finally {
    await fixture.close();
  }
});
