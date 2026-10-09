import { EventEmitter } from "node:events";
import { request } from "node:https";
import type { RequestOptions, IncomingMessage } from "node:http";
import { NodeWebhookTransport } from "./node-webhook-transport";

jest.mock("node:https", () => ({ request: jest.fn() }));
const url = "https://receiver.example/hook";
const resolver = jest.fn(() => Promise.resolve([{ address: "93.184.216.34" }]));
const input = { url, body: Buffer.from("{}"), headers: {} };
let options: RequestOptions;
let end: jest.Mock;
let destroyed: jest.Mock;

function response(status: number, headers: Record<string, string> = {}) {
  const res = Object.assign(new EventEmitter(), {
    statusCode: status,
    headers,
    destroy: jest.fn(),
  });
  jest.mocked(request).mockImplementation(((
    opts: RequestOptions,
    callback: (res: IncomingMessage) => void,
  ) => {
    options = opts;
    destroyed = jest.fn();
    end = jest.fn(() =>
      queueMicrotask(() => callback(res as unknown as IncomingMessage)),
    );
    return Object.assign(new EventEmitter(), {
      end,
      destroy: destroyed,
      setTimeout: jest.fn(),
    });
  }) as unknown as typeof request);
  return res;
}

describe("pinned webhook HTTPS transport", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolver.mockResolvedValue([{ address: "93.184.216.34" }]);
  });
  it("validates configuration without sending and rejects invalid deadlines", async () => {
    const transport = new NodeWebhookTransport(
      [" RECEIVER.EXAMPLE ", ""],
      resolver,
    );
    await expect(transport.validate(url)).resolves.toBeUndefined();
    await expect(
      transport.validate("https://other.example"),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(transport.validate("not a URL")).rejects.toMatchObject({
      code: "invalid_request",
    });
    for (const milliseconds of [0, 10001, NaN, 1.2])
      expect(
        () => new NodeWebhookTransport([], resolver, milliseconds),
      ).toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("times out configuration DNS without late sends", async () => {
    jest.useFakeTimers();
    const transport = new NodeWebhookTransport(
      ["receiver.example"],
      () => new Promise(() => {}),
      20,
    );
    const pending = expect(transport.validate(url)).rejects.toMatchObject({
      code: "invalid_request",
    });
    await jest.advanceTimersByTimeAsync(21);
    await pending;
    jest.useRealTimers();
  });
  it.each([
    ["CERT_HAS_EXPIRED", "egress_blocked"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "egress_blocked"],
    ["HPE_HEADER_OVERFLOW", "receiver_rejected"],
    ["ECONNRESET", "receiver_unavailable"],
  ])("redacts network error %s", async (code, category) => {
    jest.mocked(request).mockImplementation((() => {
      const req = Object.assign(new EventEmitter(), {
        end: jest.fn(),
        destroy: jest.fn(),
      });
      queueMicrotask(() =>
        req.emit(
          "error",
          Object.assign(new Error("secret upstream details"), { code }),
        ),
      );
      return req;
    }) as unknown as typeof request);
    const result = await new NodeWebhookTransport(
      ["receiver.example"],
      resolver,
    ).post(input);
    expect(result).toMatchObject({ outcome: "failed", category });
    expect(JSON.stringify(result)).not.toContain("secret upstream details");
  });
  it("does not reuse DNS approval and bounds time after creating the socket", async () => {
    response(204);
    const transport = new NodeWebhookTransport(["receiver.example"], resolver);
    await expect(transport.post(input)).resolves.toMatchObject({
      outcome: "succeeded",
    });
    resolver.mockResolvedValue([{ address: "10.0.0.1" }]);
    await expect(transport.post(input)).resolves.toMatchObject({
      category: "egress_blocked",
    });
    expect(request).toHaveBeenCalledTimes(1);
    jest.useFakeTimers();
    const destroy = jest.fn();
    jest.mocked(request).mockImplementation((() =>
      Object.assign(new EventEmitter(), {
        end: jest.fn(),
        destroy,
      })) as unknown as typeof request);
    resolver.mockResolvedValue([{ address: "93.184.216.34" }]);
    const pending = new NodeWebhookTransport(
      ["receiver.example"],
      resolver,
      20,
    ).post(input);
    await jest.advanceTimersByTimeAsync(21);
    expect(await pending).toMatchObject({ category: "timeout" });
    expect(destroy).toHaveBeenCalled();
    jest.useRealTimers();
  });
  it("settles invalid HTTP statuses, DNS errors and synchronous request failure", async () => {
    response(0);
    const transport = new NodeWebhookTransport(["receiver.example"], resolver);
    await expect(
      transport.post({ ...input, beforeSend: () => Promise.resolve(true) }),
    ).resolves.toMatchObject({
      category: "receiver_rejected",
      code: "invalid_http_status",
      status: null,
    });
    jest.mocked(request).mockImplementation(() => {
      throw new Error("secret socket exception");
    });
    await expect(transport.post(input)).resolves.toMatchObject({
      category: "receiver_unavailable",
      code: "network_error",
    });
    resolver.mockRejectedValueOnce(new Error("secret DNS exception"));
    await expect(transport.post(input)).resolves.toMatchObject({
      category: "egress_blocked",
    });
    await expect(
      transport.post({ ...input, body: Buffer.alloc(0) }),
    ).resolves.toMatchObject({ category: "configuration" });
  });
  it("acknowledges headers without reading or retaining any receiver body", async () => {
    const res = response(204);
    const result = await new NodeWebhookTransport(
      ["receiver.example"],
      resolver,
    ).post(input);
    expect(result).toMatchObject({
      outcome: "succeeded",
      status: 204,
      responseBytes: 0,
    });
    expect(options).toMatchObject({
      method: "POST",
      hostname: "receiver.example",
      family: 4,
      path: "/hook",
      maxHeaderSize: 16384,
    });
    expect(end).toHaveBeenCalledWith(input.body);
    expect(res.destroy).toHaveBeenCalled();
    expect(res.listenerCount("data")).toBe(0);
    const callback = jest.fn();
    (
      options.lookup as unknown as (
        host: string,
        opts: unknown,
        cb: typeof callback,
      ) => void
    )("receiver.example", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
  });
  it.each([
    [302, "egress_blocked"],
    [307, "egress_blocked"],
    [401, "receiver_rejected"],
    [403, "receiver_rejected"],
    [408, "timeout"],
    [425, "receiver_unavailable"],
    [429, "rate_limit"],
    [500, "receiver_unavailable"],
    [501, "receiver_rejected"],
    [503, "receiver_unavailable"],
    [505, "receiver_rejected"],
  ])("classifies %i safely without redirecting", async (status, category) => {
    response(status, { "retry-after": "7" });
    const result = await new NodeWebhookTransport(
      ["receiver.example"],
      resolver,
    ).post(input);
    expect(result).toMatchObject({
      outcome: "failed",
      status,
      category,
      responseBytes: 0,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("response body");
  });
  it("honors Retry-After dates and values beyond the run deadline", async () => {
    response(429, { "retry-after": "90000" });
    expect(
      await new NodeWebhookTransport(["receiver.example"], resolver).post(
        input,
      ),
    ).toMatchObject({ retryAfterSeconds: 90000 });
    response(503, {
      "retry-after": new Date(Date.now() + 30_000).toUTCString(),
    });
    const dated = await new NodeWebhookTransport(
      ["receiver.example"],
      resolver,
    ).post(input);
    expect(dated.outcome).toBe("failed");
    if (dated.outcome === "failed")
      expect(typeof dated.retryAfterSeconds).toBe("number");
    response(429, { "retry-after": "secret upstream value" });
    expect(
      await new NodeWebhookTransport(["receiver.example"], resolver).post(
        input,
      ),
    ).toMatchObject({ retryAfterSeconds: null });
  });
  it("pins public IPv6 and rejects normalized invalid Retry-After dates", async () => {
    response(204);
    resolver.mockResolvedValue([{ address: "2606:4700:4700::1111" }]);
    await new NodeWebhookTransport(["receiver.example"], resolver).post(input);
    expect(options.family).toBe(6);
    response(429, { "retry-after": "Tue, 31 Feb 2026 12:00:00 GMT" });
    expect(
      await new NodeWebhookTransport(["receiver.example"], resolver).post(
        input,
      ),
    ).toMatchObject({ retryAfterSeconds: null });
  });
  it("blocks private/mixed/rebound DNS and unsafe URLs before transmission", async () => {
    response(204);
    const transport = new NodeWebhookTransport(["receiver.example"], resolver);
    for (const url of [
      "http://receiver.example",
      "https://user:password@receiver.example",
      "https://receiver.example?token=x",
      "https://receiver.example#fragment",
      "https://127.0.0.1/hook",
      "https://receiver.example:8443",
      "https://other.example",
    ]) {
      expect(await transport.post({ ...input, url })).toMatchObject({
        category: "egress_blocked",
      });
    }
    resolver.mockResolvedValue([
      { address: "93.184.216.34" },
      { address: "169.254.169.254" },
    ]);
    expect(await transport.post(input)).toMatchObject({
      category: "egress_blocked",
    });
    resolver.mockResolvedValue([{ address: "::ffff:7f00:1" }]);
    expect(await transport.post(input)).toMatchObject({
      category: "egress_blocked",
    });
    expect(request).not.toHaveBeenCalled();
  });
  it("bounds DNS time and sends no request after a late resolution", async () => {
    jest.useFakeTimers();
    const transport = new NodeWebhookTransport(
      ["receiver.example"],
      () => new Promise(() => {}),
      20,
    );
    const pending = transport.post(input);
    await jest.advanceTimersByTimeAsync(21);
    expect(await pending).toMatchObject({
      outcome: "failed",
      category: "timeout",
    });
    expect(request).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
  it("rejects oversized requests and changed authorization without HTTP effects", async () => {
    response(204);
    const transport = new NodeWebhookTransport(["receiver.example"], resolver);
    expect(
      await transport.post({ ...input, body: Buffer.alloc(8193) }),
    ).toMatchObject({ category: "configuration" });
    expect(
      await transport.post({
        ...input,
        beforeSend: () => Promise.resolve(false),
      }),
    ).toMatchObject({ category: "authorization" });
    expect(
      await transport.post({
        ...input,
        beforeSend: () => Promise.reject(new Error("secret policy details")),
      }),
    ).toMatchObject({ category: "authorization" });
    expect(request).not.toHaveBeenCalled();
  });
});
