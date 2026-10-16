import { EventEmitter } from "node:events";
import { request, type RequestOptions } from "node:https";
import type { IncomingMessage, OutgoingHttpHeaders } from "node:http";
import type { ConnectionOptions } from "node:tls";
type TestOptions = RequestOptions & {
  headers: OutgoingHttpHeaders;
  lookup: (
    host: string,
    options: object,
    callback: (...values: unknown[]) => void,
  ) => void;
};
import { connect } from "node:tls";
import {
  NodeSiemTransport,
  parseSiemApprovedTargets,
} from "./node-siem-transport";
jest.mock("node:https", () => ({ request: jest.fn() }));
jest.mock("node:tls", () => ({ connect: jest.fn() }));
const targets = [
  { protocol: "https" as const, hostname: "collector.example", port: 443 },
  {
    protocol: "syslog_tls" as const,
    hostname: "collector.example",
    port: 6514,
  },
];
const lookup = jest.fn(() => Promise.resolve([{ address: "93.184.216.34" }]));
const credential = { mode: "bearer" as const, token: "secret-canary" };
const input = {
  protocol: "https" as const,
  endpoint: "https://collector.example/events",
  format: "json" as const,
  body: Buffer.from('{"eventId":"123"}'),
  eventId: "123",
  credential,
};
function http(status = 202, headers = {}) {
  const response = { statusCode: status, headers, destroy: jest.fn() };
  const req = Object.assign(new EventEmitter(), {
    end: jest.fn(() =>
      queueMicrotask(() => callback(response as unknown as IncomingMessage)),
    ),
    destroy: jest.fn(),
  });
  let callback: (response: IncomingMessage) => void;
  jest.mocked(request).mockImplementation(((
    options: RequestOptions,
    cb: (res: IncomingMessage) => void,
  ) => {
    callback = cb;
    return req;
  }) as unknown as typeof request);
  return req;
}
describe("SIEM transport", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lookup.mockResolvedValue([{ address: "93.184.216.34" }]);
  });
  it("parses exact deployment targets and rejects malformed configuration", () => {
    expect(parseSiemApprovedTargets(JSON.stringify(targets))).toEqual(targets);
    expect(() => parseSiemApprovedTargets('[{"protocol":"http"}]')).toThrow();
  });
  it("pins HTTPS and sets authentication without consuming response bodies", async () => {
    http();
    expect(
      await new NodeSiemTransport(targets, lookup).send(input),
    ).toMatchObject({ outcome: "accepted", status: 202 });
    const options = jest.mocked(request).mock
      .calls[0]![0] as unknown as TestOptions;
    expect(options.minVersion).toBe("TLSv1.2");
    expect(options.headers.authorization).toBe("Bearer secret-canary");
    const cb = jest.fn();
    options.lookup("ignored", {}, cb);
    expect(cb).toHaveBeenCalledWith(null, "93.184.216.34", 4);
  });
  it.each([
    [302, false, "redirect_rejected"],
    [429, true, "http_429"],
    [503, true, "http_503"],
    [401, false, "http_401"],
  ])("classifies HTTP %s", async (status, retryable, code) => {
    http(status, { "retry-after": "999999999" });
    expect(
      await new NodeSiemTransport(targets, lookup).send(input),
    ).toMatchObject({ outcome: "failed", retryable, code });
  });
  it.each([
    "https://collector.example:444/events",
    "http://collector.example/events",
    "https://collector.example/events?token=secret",
    "https://user:secret@collector.example/events",
    "https://127.0.0.1/events",
  ])("blocks endpoint %s", async (endpoint) => {
    expect(
      await new NodeSiemTransport(targets, lookup).send({ ...input, endpoint }),
    ).toMatchObject({ outcome: "failed", code: "endpoint_not_approved" });
    expect(request).not.toHaveBeenCalled();
  });
  it("rejects private DNS and authorization changes", async () => {
    lookup.mockResolvedValue([{ address: "127.0.0.1" }]);
    expect(
      await new NodeSiemTransport(targets, lookup).send(input),
    ).toMatchObject({ code: "endpoint_not_approved" });
    lookup.mockResolvedValue([{ address: "93.184.216.34" }]);
    expect(
      await new NodeSiemTransport(targets, lookup).send({
        ...input,
        beforeSend: () => Promise.resolve(false),
      }),
    ).toMatchObject({ code: "authorization_changed" });
    expect(request).not.toHaveBeenCalled();
  });
  it("bounds payload and rejects bearer syslog", async () => {
    expect(
      await new NodeSiemTransport(targets, lookup).send({
        ...input,
        body: Buffer.alloc(8193),
      }),
    ).toMatchObject({ code: "payload_size_invalid" });
    expect(
      await new NodeSiemTransport(targets, lookup).send({
        ...input,
        protocol: "syslog_tls",
        endpoint: "tls://collector.example:6514",
      }),
    ).toMatchObject({ code: "credential_invalid" });
  });
  it.each(["json", "cef"] as const)(
    "frames UTF8 %s syslog without claiming receiver acknowledgement",
    async (format) => {
      let opts: ConnectionOptions = {};
      const socket = Object.assign(new EventEmitter(), {
        write: jest.fn((_b: Buffer, cb: (error?: Error) => void) => cb()),
        end: jest.fn(),
        destroy: jest.fn(),
        authorized: true,
      });
      jest.mocked(connect).mockImplementation(((
        o: ConnectionOptions,
        cb: () => void,
      ) => {
        opts = o;
        queueMicrotask(cb);
        return socket;
      }) as unknown as typeof connect);
      const result = await new NodeSiemTransport(targets, lookup).send({
        ...input,
        protocol: "syslog_tls",
        endpoint: "tls://collector.example:6514",
        format,
        body: Buffer.from("é"),
        credential: { mode: "mtls", certificate: "cert", privateKey: "key" },
      });
      expect(result.outcome).toBe("sent_unacknowledged");
      expect(opts.rejectUnauthorized).toBe(true);
      const frame = socket.write.mock.calls[0]![0];
      const split = frame.indexOf(32);
      expect(Number(frame.subarray(0, split).toString())).toBe(
        frame.subarray(split + 1).byteLength,
      );
    },
  );
  it("uses CEF content type", async () => {
    http();
    await new NodeSiemTransport(targets, lookup).send({
      ...input,
      format: "cef",
    });
    expect(
      (jest.mocked(request).mock.calls[0]![0] as unknown as TestOptions)
        .headers["content-type"],
    ).toBe("text/plain; charset=utf-8");
  });
});

describe("SIEM failure fences", () => {
  it("validates without sending and rejects invalid deadlines", async () => {
    const t = new NodeSiemTransport(targets, lookup);
    await expect(t.validate("https", input.endpoint)).resolves.toBeUndefined();
    await expect(t.validate("https", "broken")).rejects.toThrow();
    for (const deadline of [0, 10001, NaN, 1.2])
      expect(() => new NodeSiemTransport(targets, lookup, deadline)).toThrow();
  });
  it("bounds unresolved DNS in validation and sends", async () => {
    jest.useFakeTimers();
    const t = new NodeSiemTransport(
      targets,
      async () => new Promise(() => {}),
      10,
    );
    const validation = expect(
      t.validate("https", input.endpoint),
    ).rejects.toThrow();
    const pending = t.send(input);
    await jest.advanceTimersByTimeAsync(11);
    await validation;
    expect(await pending).toMatchObject({ code: "delivery_timeout" });
    jest.useRealTimers();
  });
  it.each(["CERT_HAS_EXPIRED", "ECONNRESET", "HPE_HEADER_OVERFLOW"])(
    "sanitizes %s",
    async (code) => {
      const req = Object.assign(new EventEmitter(), {
        end: jest.fn(() =>
          queueMicrotask(() =>
            req.emit(
              "error",
              Object.assign(new Error("secret-canary"), { code }),
            ),
          ),
        ),
        destroy: jest.fn(),
      });
      jest
        .mocked(request)
        .mockReturnValue(req as unknown as ReturnType<typeof request>);
      const result = await new NodeSiemTransport(targets, lookup).send(input);
      expect(result.outcome).toBe("failed");
      expect(JSON.stringify(result)).not.toContain("secret-canary");
    },
  );
  it.each([425, 408, 501, 505, 0, 204])(
    "classifies status %s",
    async (status) => {
      http(status, {
        "retry-after": new Date(Date.now() + 10000).toUTCString(),
      });
      const result = await new NodeSiemTransport(targets, lookup).send(input);
      expect(result.outcome).toBe(status === 204 ? "accepted" : "failed");
    },
  );
  it("supports mTLS HTTPS without an authorization header", async () => {
    http();
    await new NodeSiemTransport(targets, lookup).send({
      ...input,
      credential: {
        mode: "mtls",
        certificate: "cert",
        privateKey: "key",
        ca: "ca",
      },
    });
    const options = jest
      .mocked(request)
      .mock.calls.at(-1)![0] as unknown as TestOptions;
    expect(options.cert).toBe("cert");
    expect(options.headers.authorization).toBeUndefined();
  });
  it("never sends after failed current authorization", async () => {
    expect(
      await new NodeSiemTransport(targets, lookup).send({
        ...input,
        beforeSend: () => Promise.reject(new Error("secret")),
      }),
    ).toMatchObject({ code: "authorization_changed" });
  });
  it("tolerates DNS failures without disclosure", async () => {
    expect(
      await new NodeSiemTransport(targets, () =>
        Promise.reject(new Error("secret")),
      ).send(input),
    ).toMatchObject({ code: "endpoint_not_approved" });
  });
  it("rejects unauthenticated syslog socket", async () => {
    const socket = Object.assign(new EventEmitter(), {
      authorized: false,
      destroy: jest.fn(),
    });
    jest.mocked(connect).mockImplementation(((
      options: ConnectionOptions,
      cb: () => void,
    ) => {
      queueMicrotask(cb);
      return socket;
    }) as unknown as typeof connect);
    expect(
      await new NodeSiemTransport(targets, lookup).send({
        ...input,
        protocol: "syslog_tls",
        endpoint: "tls://collector.example",
        credential: { mode: "mtls", certificate: "cert", privateKey: "key" },
      }),
    ).toMatchObject({ code: "tls_verification_failed" });
  });
  it("reports failed syslog writes and closed sockets as uncertain failures", async () => {
    for (const event of ["write", "close"]) {
      const socket = Object.assign(new EventEmitter(), {
        authorized: true,
        write: jest.fn((_b: Buffer, cb: (error?: Error) => void) =>
          cb(Object.assign(new Error("secret"), { code: "ECONNRESET" })),
        ),
        destroy: jest.fn(),
      });
      jest.mocked(connect).mockImplementation(((
        options: ConnectionOptions,
        cb: () => void,
      ) => {
        queueMicrotask(() => (event === "write" ? cb() : socket.emit("close")));
        return socket;
      }) as unknown as typeof connect);
      expect(
        await new NodeSiemTransport(targets, lookup).send({
          ...input,
          protocol: "syslog_tls",
          endpoint: "tls://collector.example",
          credential: { mode: "mtls", certificate: "cert", privateKey: "key" },
        }),
      ).toMatchObject({ outcome: "failed", retryable: true });
    }
  });
});
