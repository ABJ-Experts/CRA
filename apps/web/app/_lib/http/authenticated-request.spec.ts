import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import { authenticatedRequestJson } from "./authenticated-request";

const successSchema = z.object({ ok: z.literal(true) }).strict();

const errorResponse = (status: number) =>
  new Response(
    JSON.stringify({
      statusCode: status,
      message: status === 401 ? "Expired" : "Request failed",
    }),
    { status },
  );

describe("authenticatedRequestJson", () => {
  it("shares one refresh across concurrent GET requests and retries each once", async () => {
    const attemptsByPath = new Map<string, number>();
    let releaseRefresh: (() => void) | undefined;
    const refreshBarrier = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/v1/auth/refresh") {
        await refreshBarrier;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const attempt = (attemptsByPath.get(path) ?? 0) + 1;
      attemptsByPath.set(path, attempt);
      return attempt === 1
        ? errorResponse(401)
        : new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const requests = Promise.all([
      authenticatedRequestJson({
        path: "/api/v1/a",
        schema: successSchema,
        fetcher,
      }),
      authenticatedRequestJson({
        path: "/api/v1/b",
        schema: successSchema,
        fetcher,
      }),
    ]);
    await vi.waitFor(() => {
      expect(
        fetcher.mock.calls.filter(
          ([input]) => String(input) === "/api/v1/auth/refresh",
        ),
      ).toHaveLength(1);
    });
    releaseRefresh?.();

    await expect(requests).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(attemptsByPath).toEqual(
      new Map([
        ["/api/v1/a", 2],
        ["/api/v1/b", 2],
      ]),
    );
  });

  it("retries a failed GET only once even if the replay is also unauthorized", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/v1/auth/refresh"
        ? new Response(JSON.stringify({ ok: true }), { status: 200 })
        : errorResponse(401),
    );

    await expect(
      authenticatedRequestJson({
        path: "/api/v1/session",
        schema: successSchema,
        fetcher,
      }),
    ).rejects.toMatchObject({ kind: "api", status: 401 });

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(
      fetcher.mock.calls.filter(
        ([input]) => String(input) === "/api/v1/session",
      ),
    ).toHaveLength(2);
  });

  it.each(["POST", "PATCH", "PUT", "DELETE"] as const)(
    "never refreshes or replays %s after a 401",
    async (method) => {
      const fetcher = vi.fn(async () => errorResponse(401));

      await expect(
        authenticatedRequestJson({
          path: "/api/v1/mutation",
          method,
          body: { value: 1 },
          schema: successSchema,
          fetcher,
        }),
      ).rejects.toMatchObject({ kind: "api", status: 401 });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each([403, 429, 500])(
    "does not refresh or replay a GET after status %s",
    async (status) => {
      const fetcher = vi.fn(async () => errorResponse(status));

      await expect(
        authenticatedRequestJson({
          path: "/api/v1/session",
          schema: successSchema,
          fetcher,
        }),
      ).rejects.toMatchObject({ kind: "api", status });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("does not retry an invalid success response", async () => {
    const fetcher = vi.fn(async () => new Response("<html>bad</html>"));

    await expect(
      authenticatedRequestJson({
        path: "/api/v1/session",
        schema: successSchema,
        fetcher,
      }),
    ).rejects.toMatchObject({ kind: "invalid_response" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not retry an aborted GET", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    const fetcher = vi.fn(async () => {
      throw abortError;
    });

    await expect(
      authenticatedRequestJson({
        path: "/api/v1/session",
        schema: successSchema,
        fetcher,
      }),
    ).rejects.toBe(abortError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("propagates refresh failure and clears the single-flight slot", async () => {
    let refreshCalls = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) !== "/api/v1/auth/refresh") return errorResponse(401);
      refreshCalls += 1;
      return errorResponse(401);
    });

    await expect(
      authenticatedRequestJson({
        path: "/api/v1/a",
        schema: successSchema,
        fetcher,
      }),
    ).rejects.toMatchObject({ kind: "api", status: 401 });
    await expect(
      authenticatedRequestJson({
        path: "/api/v1/b",
        schema: successSchema,
        fetcher,
      }),
    ).rejects.toMatchObject({ kind: "api", status: 401 });
    expect(refreshCalls).toBe(2);
  });
});
