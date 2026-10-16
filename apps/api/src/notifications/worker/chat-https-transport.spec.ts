import { EventEmitter } from "node:events";
import { request } from "node:https";
import type { IncomingMessage, RequestOptions } from "node:http";
import { ChatHttpsTransport } from "./chat-https-transport";

jest.mock("node:https", () => ({ request: jest.fn() }));
const resolver = jest.fn(() => Promise.resolve([{ address: "93.184.216.34" }]));
const input = {
  url: "https://hooks.slack.com/services/T/B/secret?token=query-secret",
  allowedHosts: ["hooks.slack.com"],
  headers: { "content-type": "application/json" },
  body: Buffer.from('{"text":"test"}'),
};

function receive(
  status: number,
  body: string,
  headers: Record<string, string> = {},
) {
  let options: RequestOptions;
  let requestBody: Buffer;
  const response = Object.assign(new EventEmitter(), {
    statusCode: status,
    headers,
    destroy: jest.fn(),
  });
  jest.mocked(request).mockImplementation(((
    opts: RequestOptions,
    callback: (res: IncomingMessage) => void,
  ) => {
    options = opts;
    const req = Object.assign(new EventEmitter(), {
      end: jest.fn((payload: Buffer) => {
        requestBody = payload;
        queueMicrotask(() => {
          callback(response as unknown as IncomingMessage);
          response.emit("data", Buffer.from(body));
          response.emit("end");
        });
      }),
      destroy: jest.fn(),
    });
    return req;
  }) as unknown as typeof request);
  return {
    options: () => options!,
    requestBody: () => requestBody!,
  };
}

describe("chat HTTPS transport", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolver.mockResolvedValue([{ address: "93.184.216.34" }]);
  });

  it("pins public DNS, validates TLS hostname, keeps secret query in request only", async () => {
    const probe = receive(200, "ok");
    const result = await new ChatHttpsTransport(resolver).post(input);
    expect(result).toMatchObject({
      outcome: "response",
      status: 200,
      body: "ok",
    });
    expect(probe.options()).toMatchObject({
      hostname: "hooks.slack.com",
      servername: "hooks.slack.com",
      family: 4,
      rejectUnauthorized: true,
      method: "POST",
      path: "/services/T/B/secret?token=query-secret",
    });
    expect(probe.requestBody()).toEqual(input.body);
    expect(JSON.stringify(result)).not.toContain("query-secret");
  });

  it("blocks private DNS, redirects and wrong hosts", async () => {
    const transport = new ChatHttpsTransport(resolver);
    resolver.mockResolvedValueOnce([{ address: "127.0.0.1" }]);
    expect(await transport.post(input)).toMatchObject({
      outcome: "failure",
      code: "egress_blocked",
      uncertain: false,
    });
    expect(request).not.toHaveBeenCalled();
    receive(302, "moved", { location: "https://127.0.0.1/" });
    expect(await transport.post(input)).toMatchObject({
      outcome: "response",
      status: 302,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(
      await transport.post({ ...input, url: "https://attacker.example/" }),
    ).toMatchObject({ outcome: "failure", code: "egress_blocked" });
  });

  it("reports bounded Retry-After and redacts TLS errors", async () => {
    receive(429, "slow", { "retry-after": "8" });
    expect(await new ChatHttpsTransport(resolver).post(input)).toMatchObject({
      outcome: "response",
      retryAfterSeconds: 8,
    });
    jest.mocked(request).mockImplementation((() => {
      const req = Object.assign(new EventEmitter(), {
        end: jest.fn(() =>
          queueMicrotask(() =>
            req.emit(
              "error",
              Object.assign(new Error("secret host detail"), {
                code: "ERR_TLS_CERT_ALTNAME_INVALID",
              }),
            ),
          ),
        ),
        destroy: jest.fn(),
      });
      return req;
    }) as unknown as typeof request);
    const failure = await new ChatHttpsTransport(resolver).post(input);
    expect(failure).toMatchObject({
      outcome: "failure",
      code: "tls_verification_failed",
    });
    expect(JSON.stringify(failure)).not.toContain("secret host detail");
  });

  it("settles rate-limit headers even when the provider never finishes its body", async () => {
    jest.useFakeTimers();
    const response = Object.assign(new EventEmitter(), {
      statusCode: 429,
      headers: { "retry-after": "9" },
      destroy: jest.fn(),
    });
    jest.mocked(request).mockImplementation(((
      _options: RequestOptions,
      callback: (res: IncomingMessage) => void,
    ) =>
      Object.assign(new EventEmitter(), {
        end: jest.fn(() =>
          queueMicrotask(() =>
            callback(response as unknown as IncomingMessage),
          ),
        ),
        destroy: jest.fn(),
      })) as unknown as typeof request);
    const pending = new ChatHttpsTransport(resolver, 25).post(input);
    await jest.advanceTimersByTimeAsync(26);
    expect(await pending).toMatchObject({
      outcome: "response",
      status: 429,
      retryAfterSeconds: 9,
    });
    expect(response.destroy).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it("marks a timeout after socket write as uncertain", async () => {
    jest.useFakeTimers();
    const destroyed = jest.fn();
    jest.mocked(request).mockImplementation((() =>
      Object.assign(new EventEmitter(), {
        end: jest.fn(),
        destroy: destroyed,
      })) as unknown as typeof request);
    const result = new ChatHttpsTransport(resolver, 25).post(input);
    await jest.advanceTimersByTimeAsync(26);
    expect(await result).toMatchObject({
      outcome: "failure",
      code: "delivery_timeout",
      uncertain: true,
    });
    expect(destroyed).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it("rejects malformed and oversized requests before any socket", async () => {
    const transport = new ChatHttpsTransport(resolver);
    for (const milliseconds of [0, 10_001, NaN, 1.5])
      expect(() => new ChatHttpsTransport(resolver, milliseconds)).toThrow();
    for (const url of [
      "not a URL",
      `${input.url}#fragment`,
      `https://hooks.slack.com/${"a".repeat(4096)}`,
    ])
      expect(await transport.post({ ...input, url })).toMatchObject({
        outcome: "failure",
        code: "egress_blocked",
        uncertain: false,
      });
    for (const body of [Buffer.alloc(0), Buffer.alloc(28 * 1024 + 1)])
      expect(await transport.post({ ...input, body })).toMatchObject({
        outcome: "failure",
        code: "payload_size_invalid",
        uncertain: false,
      });
    expect(request).not.toHaveBeenCalled();
  });

  it("revalidates authorization after DNS and before sending", async () => {
    const transport = new ChatHttpsTransport(resolver);
    expect(
      await transport.post({
        ...input,
        beforeSend: () => Promise.resolve(false),
      }),
    ).toMatchObject({
      outcome: "failure",
      code: "authorization_changed",
      uncertain: false,
    });
    expect(
      await transport.post({
        ...input,
        beforeSend: () => Promise.reject(new Error("private access detail")),
      }),
    ).toMatchObject({
      outcome: "failure",
      code: "authorization_changed",
      uncertain: false,
    });
    expect(request).not.toHaveBeenCalled();
    receive(204, "");
    expect(
      await transport.post({
        ...input,
        beforeSend: () => Promise.resolve(true),
      }),
    ).toMatchObject({ outcome: "response", status: 204 });
  });

  it("contains DNS, socket, and response stream failures without leaking details", async () => {
    const transport = new ChatHttpsTransport(resolver);
    resolver.mockRejectedValueOnce(new Error("secret DNS detail"));
    expect(await transport.post(input)).toMatchObject({
      outcome: "failure",
      code: "egress_blocked",
    });
    jest.mocked(request).mockImplementation(() => {
      throw new Error("secret synchronous socket detail");
    });
    expect(await transport.post(input)).toMatchObject({
      outcome: "failure",
      code: "network_error",
      uncertain: false,
    });
    jest.mocked(request).mockImplementation((() => {
      const req = Object.assign(new EventEmitter(), {
        end: jest.fn(() =>
          queueMicrotask(() =>
            req.emit(
              "error",
              Object.assign(new Error("secret reset detail"), {
                code: "ECONNRESET",
              }),
            ),
          ),
        ),
        destroy: jest.fn(),
      });
      return req;
    }) as unknown as typeof request);
    const reset = await transport.post(input);
    expect(reset).toMatchObject({
      outcome: "failure",
      code: "network_error",
      uncertain: true,
    });
    expect(JSON.stringify(reset)).not.toContain("secret reset detail");
  });

  it.each(["ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH"])(
    "treats definitive pre-connect %s as safely retryable",
    async (code) => {
      jest.mocked(request).mockImplementation((() => {
        const req = Object.assign(new EventEmitter(), {
          end: jest.fn(() =>
            queueMicrotask(() =>
              req.emit(
                "error",
                Object.assign(new Error("private socket detail"), { code }),
              ),
            ),
          ),
          destroy: jest.fn(),
        });
        return req;
      }) as unknown as typeof request);
      const result = await new ChatHttpsTransport(resolver).post(input);
      expect(result).toMatchObject({
        outcome: "failure",
        code: "network_error",
        uncertain: false,
      });
      expect(JSON.stringify(result)).not.toContain("private socket detail");
    },
  );

  it("bounds response bodies and handles broken streams", async () => {
    const response = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headers: {},
      destroy: jest.fn(),
    });
    jest.mocked(request).mockImplementation(((
      _options: RequestOptions,
      callback: (res: IncomingMessage) => void,
    ) =>
      Object.assign(new EventEmitter(), {
        end: jest.fn(() =>
          queueMicrotask(() => {
            callback(response as unknown as IncomingMessage);
            response.emit("data", Buffer.alloc(16 * 1024 + 1));
            response.emit("end");
          }),
        ),
        destroy: jest.fn(),
      })) as unknown as typeof request);
    expect(await new ChatHttpsTransport(resolver).post(input)).toMatchObject({
      outcome: "failure",
      code: "response_too_large",
      uncertain: true,
    });
    expect(response.destroy).toHaveBeenCalled();
    jest.mocked(request).mockImplementation(((
      _options: RequestOptions,
      callback: (res: IncomingMessage) => void,
    ) =>
      Object.assign(new EventEmitter(), {
        end: jest.fn(() =>
          queueMicrotask(() => {
            callback(response as unknown as IncomingMessage);
            response.emit("error", new Error("secret stream detail"));
          }),
        ),
        destroy: jest.fn(),
      })) as unknown as typeof request);
    expect(await new ChatHttpsTransport(resolver).post(input)).toMatchObject({
      outcome: "failure",
      code: "network_error",
      uncertain: true,
    });
  });

  it("accepts a valid Retry-After date and ignores malformed headers", async () => {
    const date = new Date(Date.now() + 30_000).toUTCString();
    receive(429, "", { "retry-after": date });
    const dated = await new ChatHttpsTransport(resolver).post(input);
    expect(dated.outcome).toBe("response");
    if (dated.outcome === "response")
      expect(dated.retryAfterSeconds).toBeGreaterThanOrEqual(29);
    receive(429, "", { "retry-after": "not a date" });
    expect(await new ChatHttpsTransport(resolver).post(input)).toMatchObject({
      outcome: "response",
      retryAfterSeconds: null,
    });
    receive(429, "", { "retry-after": "Sun, 32 Jan 2026 00:00:00 GMT" });
    expect(await new ChatHttpsTransport(resolver).post(input)).toMatchObject({
      outcome: "response",
      retryAfterSeconds: null,
    });
    receive(429, "", { "retry-after": "9999999999" });
    expect(await new ChatHttpsTransport(resolver).post(input)).toMatchObject({
      outcome: "response",
      retryAfterSeconds: 900,
    });
  });
});
