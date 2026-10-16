import { describe, expect, it, vi } from "vitest";
import { OperatorGateway } from "./operator-gateway";
import {
  instanceId,
  instances,
  operatorInstance,
  operatorSession,
  observedAt,
  tenants,
} from "./operator.fixture";
describe("private operator transport", () => {
  it("calls the default browser fetch with its global receiver", async () => {
    const fetcher = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(Response.json(operatorSession));
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      await expect(new OperatorGateway().session()).resolves.toEqual(
        operatorSession,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("allows same-origin TLS credentials without tenant auth or redirect", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(operatorSession))
      .mockResolvedValueOnce(Response.json(instances))
      .mockResolvedValueOnce(
        Response.json({
          schemaVersion: 1,
          observedAt,
          instance: operatorInstance,
        }),
      )
      .mockResolvedValueOnce(Response.json(tenants));
    const gateway = new OperatorGateway(fetcher);
    const signal = new AbortController().signal;
    await gateway.session(signal);
    await gateway.instances({}, signal);
    await gateway.instance(instanceId, signal);
    await gateway.tenants(instanceId, {}, signal);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/operator/session",
      "/api/v1/operator/instances?limit=50",
      `/api/v1/operator/instances/${instanceId}`,
      `/api/v1/operator/instances/${instanceId}/tenants?limit=50`,
    ]);
    for (const [, init] of fetcher.mock.calls)
      expect(init).toEqual({
        method: "GET",
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        cache: "no-store",
        signal,
        headers: { Accept: "application/json" },
      });
  });
  it("validates paths and bounded queries before request", async () => {
    const fetcher = vi.fn();
    const gateway = new OperatorGateway(fetcher);
    await expect(gateway.instance("../auth")).rejects.toThrow();
    await expect(gateway.instances({ limit: 101 })).rejects.toThrow();
    await expect(
      gateway.tenants(instanceId, { cursor: "//bad" }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects malformed, private, and foreign responses", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ...operatorSession, jwt: "disallowed" }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ...tenants,
          instanceId: "44444444-4444-4444-8444-444444444444",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          schemaVersion: 1,
          observedAt,
          instance: {
            ...operatorInstance,
            instanceId: "44444444-4444-4444-8444-444444444444",
          },
        }),
      );
    const gateway = new OperatorGateway(fetcher);
    await expect(gateway.session()).rejects.toMatchObject({ status: 502 });
    await expect(gateway.tenants(instanceId, {})).rejects.toMatchObject({
      status: 409,
    });
    await expect(gateway.instance(instanceId)).rejects.toMatchObject({
      status: 409,
    });
  });
  it.each([401, 403, 409, 503])(
    "keeps %s denial safe without tenant refresh",
    async (status) => {
      const fetcher = vi
        .fn()
        .mockResolvedValue(
          Response.json({ message: "internal path" }, { status }),
        );
      await expect(
        new OperatorGateway(fetcher).session(),
      ).rejects.toMatchObject({ status });
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );
});
