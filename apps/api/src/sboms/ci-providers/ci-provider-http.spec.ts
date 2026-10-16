import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";

import { resolveApprovedHttpsTarget } from "../../products/infrastructure/node-product-compliance-external-reference-validator";
import { PinnedCiProviderHttp } from "./ci-provider-http";

jest.mock("node:https", () => ({ request: jest.fn() }));
jest.mock(
  "../../products/infrastructure/node-product-compliance-external-reference-validator",
  () => ({ resolveApprovedHttpsTarget: jest.fn() }),
);

type HttpsRequest = (
  options: unknown,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

const resolver = jest.mocked(resolveApprovedHttpsTarget);
const requestMock =
  httpsRequest as unknown as jest.MockedFunction<HttpsRequest>;

function fakeRequest(status: number, body: string, headers = {}) {
  const response = Object.assign(new EventEmitter(), {
    statusCode: status,
    headers,
  }) as IncomingMessage;
  const client = Object.assign(new EventEmitter(), {
    setTimeout: jest.fn(),
    end: jest.fn(() => {
      queueMicrotask(() => {
        callback(response);
        response.emit("data", Buffer.from(body));
        response.emit("end");
      });
    }),
    destroy: jest.fn((error: Error) => client.emit("error", error)),
  }) as unknown as ClientRequest;
  let callback: (response: IncomingMessage) => void;
  requestMock.mockImplementation((_options, onResponse) => {
    callback = onResponse;
    return client;
  });
  return client;
}

const input = {
  url: "https://gitlab.example.com/api/v4/projects/1",
  headers: { "private-token": "test-only" },
  allowedHosts: ["gitlab.example.com"],
};

describe("pinned CI provider HTTP", () => {
  beforeEach(() => {
    requestMock.mockReset();
    resolver.mockReset();
    resolver.mockResolvedValue({
      url: new URL(input.url),
      address: "93.184.216.34",
      family: 4,
    });
  });

  it("pins the checked public address and limits the response to JSON", async () => {
    fakeRequest(200, '{"id":1}', { "retry-after": "5" });
    await expect(new PinnedCiProviderHttp().request(input)).resolves.toEqual({
      status: 200,
      headers: { "retry-after": "5" },
      body: { id: 1 },
    });
    const options = requestMock.mock.calls[0]?.[0] as {
      lookup: (
        hostname: string,
        options: unknown,
        callback: (error: null, address: string, family: number) => void,
      ) => void;
    };
    expect(options.lookup).toBeDefined();
    const lookup = jest.fn();
    options.lookup("gitlab.example.com", {}, lookup);
    expect(lookup).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    expect(resolver).toHaveBeenCalledWith(
      input.url,
      new Set(input.allowedHosts),
    );
  });

  it("rejects disallowed targets, redirects, invalid JSON, and oversized responses", async () => {
    resolver.mockResolvedValueOnce(null);
    await expect(new PinnedCiProviderHttp().request(input)).rejects.toThrow(
      "not approved",
    );
    fakeRequest(302, "{}");
    await expect(new PinnedCiProviderHttp().request(input)).rejects.toThrow(
      "redirect rejected",
    );
    fakeRequest(200, "not json");
    await expect(new PinnedCiProviderHttp().request(input)).rejects.toThrow(
      "Invalid CI provider response",
    );
    fakeRequest(200, "x".repeat(65_537));
    await expect(new PinnedCiProviderHttp().request(input)).rejects.toThrow(
      "too large",
    );
  });
});
