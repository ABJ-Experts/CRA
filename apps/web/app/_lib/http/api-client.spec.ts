import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import { ApiClientError, requestJson } from "./api-client";

const successSchema = z.object({ ok: z.literal(true) }).strict();

describe("requestJson", () => {
  it("validates and returns a successful JSON response", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    await expect(
      requestJson({ path: "/api/v1/test", schema: successSchema, fetcher }),
    ).resolves.toEqual({ ok: true });
  });

  it.each([
    [JSON.stringify({ ok: "yes" }), "wrong field type"],
    ["<html>success from a broken proxy</html>", "HTML"],
    ["", "an empty body"],
  ])("rejects an invalid success payload: %s (%s)", async (body) => {
    const fetcher = vi.fn(async () => new Response(body, { status: 200 }));

    await expect(
      requestJson({ path: "/api/v1/test", schema: successSchema, fetcher }),
    ).rejects.toMatchObject({
      kind: "invalid_response",
      status: 200,
      message: "The server returned an unexpected response.",
    });
  });

  it("validates a 204 response as undefined", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));

    await expect(
      requestJson({ path: "/api/v1/test", schema: z.void(), fetcher }),
    ).resolves.toBeUndefined();
  });

  it("maps a valid API error body including field errors", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            statusCode: 422,
            message: "Please correct the form.",
            code: "validation_failed",
            fieldErrors: { email: "Enter a valid email address." },
          }),
          { status: 422 },
        ),
    );

    await expect(
      requestJson({ path: "/api/v1/test", schema: successSchema, fetcher }),
    ).rejects.toMatchObject({
      kind: "api",
      status: 422,
      code: "validation_failed",
      message: "Please correct the form.",
      fieldErrors: { email: "Enter a valid email address." },
    });
  });

  it.each([
    ["<html>proxy failure</html>", "HTML"],
    ["{malformed", "malformed JSON"],
    ["", "an empty body"],
  ])("maps %s error content (%s) to a safe generic API error", async (body) => {
    const fetcher = vi.fn(async () => new Response(body, { status: 502 }));

    await expect(
      requestJson({ path: "/api/v1/test", schema: successSchema, fetcher }),
    ).rejects.toEqual(
      expect.objectContaining({
        kind: "api",
        status: 502,
        code: undefined,
        message: "Something went wrong. Please try again.",
      }),
    );
  });

  it("maps a fetch rejection to a network error without leaking details", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED secret.internal:443");
    });

    await expect(
      requestJson({ path: "/api/v1/test", schema: successSchema, fetcher }),
    ).rejects.toEqual(
      expect.objectContaining({
        kind: "network",
        message: "We could not reach the server.",
      }),
    );
  });

  it("preserves AbortError so query cancellation remains observable", async () => {
    const abortError = new DOMException(
      "This operation was aborted",
      "AbortError",
    );
    const fetcher = vi.fn(async () => {
      throw abortError;
    });

    await expect(
      requestJson({ path: "/api/v1/test", schema: successSchema, fetcher }),
    ).rejects.toBe(abortError);
  });

  it("uses same-origin credentials, no-store caching, and GET by default", async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await requestJson({ path: "/api/v1/test", schema: successSchema, fetcher });

    expect(fetcher).toHaveBeenCalledWith("/api/v1/test", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: undefined,
      headers: undefined,
      body: undefined,
    });
  });

  it("serializes a body once and forwards a custom signal", async () => {
    const controller = new AbortController();
    const body = { email: "person@example.com", enabled: true };
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await requestJson({
      path: "/api/v1/test",
      method: "POST",
      body,
      inputSchema: z.object({ email: z.email(), enabled: z.boolean() }),
      signal: controller.signal,
      schema: successSchema,
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith("/api/v1/test", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  });

  it("serializes the parsed request output and rejects invalid input before fetch", async () => {
    const inputSchema = z
      .object({
        email: z.string().trim().toLowerCase().pipe(z.email()),
        remember: z.boolean().optional().default(false),
      })
      .strict();
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await requestJson({
      path: "/api/v1/test",
      method: "POST",
      body: { email: " ADA@EXAMPLE.COM " },
      inputSchema,
      schema: successSchema,
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/test",
      expect.objectContaining({
        body: JSON.stringify({ email: "ada@example.com", remember: false }),
      }),
    );

    await expect(
      requestJson({
        path: "/api/v1/test",
        method: "POST",
        body: { email: "not-an-email" },
        inputSchema,
        schema: successSchema,
        fetcher,
      }),
    ).rejects.toMatchObject({ kind: "invalid_request" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails closed when an untyped caller supplies a body without a schema", async () => {
    const fetcher = vi.fn();
    const options = {
      path: "/api/v1/test",
      method: "POST",
      body: { untrusted: true },
      schema: successSchema,
      fetcher,
    } as unknown as Parameters<typeof requestJson>[0];

    await expect(requestJson(options)).rejects.toMatchObject({
      kind: "invalid_request",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    "api/v1/test",
    "https://example.com/api/v1/test",
    "//example.com/api/v1/test",
    String.raw`/\example.com/api/v1/test`,
  ])("rejects a non-relative path before fetch: %s", async (path) => {
    const fetcher = vi.fn();

    await expect(
      requestJson({
        path: path as `/${string}`,
        schema: successSchema,
        fetcher,
      }),
    ).rejects.toBeInstanceOf(ApiClientError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
