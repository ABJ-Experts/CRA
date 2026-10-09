import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ApiClient } from "./api-client";
import { AuthenticatedApiClient } from "./authenticated-request";
describe("bounded authenticated text GET", () => {
  it("parses CSV and retries only one GET after refresh", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response('{"ok":true}'))
      .mockResolvedValueOnce(
        new Response("metric,value\na,0", {
          headers: { "content-type": "text/csv; charset=utf-8" },
        }),
      );
    const client = new AuthenticatedApiClient(new ApiClient());
    await expect(
      client.requestText({
        path: "/api/v1/dashboard/trends/export",
        schema: z.string(),
        contentType: "text/csv",
        maxBytes: 100,
        fetcher,
      }),
    ).resolves.toBe("metric,value\na,0");
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/dashboard/trends/export",
      "/api/v1/auth/refresh",
      "/api/v1/dashboard/trends/export",
    ]);
  });
  it("rejects wrong content types, oversized streams and nonlocal paths", async () => {
    const client = new ApiClient();
    for (const response of [
      new Response("x", { headers: { "content-type": "text/html" } }),
      new Response("abcdef", { headers: { "content-type": "text/csv" } }),
    ]) {
      await expect(
        client.requestText({
          path: "/api/v1/dashboard/trends/export",
          schema: z.string(),
          contentType: "text/csv",
          maxBytes: 3,
          fetcher: vi.fn().mockResolvedValue(response),
        }),
      ).rejects.toMatchObject({ kind: "invalid_response" });
    }
    await expect(
      client.requestText({
        path: "//foreign",
        schema: z.string(),
        contentType: "text/csv",
        maxBytes: 100,
      }),
    ).rejects.toThrow();
  });
});
it("uses the compatibility text facade and never refreshes non-401 failures", async () => {
  const { authenticatedRequestText } = await import("./authenticated-request");
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response("csv", { headers: { "content-type": "text/csv" } }),
    );
  await expect(
    authenticatedRequestText({
      path: "/api/v1/dashboard/trends/export",
      schema: z.string(),
      contentType: "text/csv",
      maxBytes: 100,
      fetcher,
    }),
  ).resolves.toBe("csv");
  const client = new AuthenticatedApiClient(new ApiClient());
  const denied = vi
    .fn()
    .mockResolvedValue(new Response('{"message":"Denied"}', { status: 403 }));
  await expect(
    client.requestText({
      path: "/api/v1/dashboard/trends/export",
      schema: z.string(),
      contentType: "text/csv",
      maxBytes: 100,
      fetcher: denied,
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect(denied).toHaveBeenCalledTimes(1);
});
it("preserves authenticated multipart compatibility through the central transport", async () => {
  const { authenticatedRequestMultipart } =
    await import("./authenticated-request");
  const fetcher = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
  await expect(
    authenticatedRequestMultipart({
      path: "/api/v1/test",
      schema: z.object({ ok: z.literal(true) }),
      fieldsSchema: z.object({ name: z.string() }),
      fields: { name: "evidence" },
      file: { name: "file", value: new Blob(["evidence"]) },
      fetcher,
    }),
  ).resolves.toEqual({ ok: true });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
