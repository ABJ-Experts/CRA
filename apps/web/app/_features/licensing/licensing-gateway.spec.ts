import { describe, expect, it, vi } from "vitest";
import { LicensingGateway } from "./licensing-gateway";

describe("LicensingGateway", () => {
  it("supplies parsed versioned contracts and never replays activation", async () => {
    const transport = vi.fn();
    const gateway = new LicensingGateway(transport);
    const signal = new AbortController().signal;
    await gateway.policy(signal);
    await gateway.current(signal);
    await gateway.history({}, signal);
    await gateway.activate({
      artifact: "signed.artifact.value",
      expectedVersion: 0,
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    });
    expect(transport.mock.calls[0]?.[0]).toMatchObject({
      path: "/api/v1/licensing/policy",
      signal,
    });
    expect(transport.mock.calls[2]?.[0].path).toBe(
      "/api/v1/licensing/history?limit=20",
    );
    expect(transport.mock.calls[3]?.[0]).toMatchObject({
      path: "/api/v1/licensing/activate",
      method: "POST",
      inputSchema: expect.any(Object),
      schema: expect.any(Object),
    });
  });
  it("rejects forged scope and excessive limits before sending", () => {
    const transport = vi.fn();
    const gateway = new LicensingGateway(transport);
    expect(() => gateway.history({ limit: 101 })).toThrow();
    expect(() =>
      gateway.activate({
        artifact: "x".repeat(32769),
        expectedVersion: 0,
        idempotencyKey: "invalid",
      }),
    ).toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});
it("encodes a bounded history cursor", async () => {
  const transport = vi.fn();
  const gateway = new LicensingGateway(transport);
  await gateway.history({ cursor: "next/opaque", limit: 10 });
  expect(transport.mock.calls[0]?.[0].path).toBe(
    "/api/v1/licensing/history?limit=10&cursor=next%2Fopaque",
  );
});
