import { afterEach, describe, expect, it, vi } from "vitest";

import { membersApi } from "./members.api";

const identity = {
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  correlationId: "22222222-2222-4222-8222-222222222222",
} as const;

describe("membersApi", () => {
  const userId = "a05570d6-aa75-4b6a-9688-b5a82eb3a774";
  afterEach(() => vi.unstubAllGlobals());

  it("changes a member role with the exact request and signal", async () => {
    const signal = new AbortController().signal;
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(
      membersApi.changeRole(
        "a05570d6-aa75-4b6a-9688-b5a82eb3a774",
        "admin",
        identity,
        signal,
      ),
    ).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/users/a05570d6-aa75-4b6a-9688-b5a82eb3a774/role",
      {
        method: "PATCH",
        credentials: "same-origin",
        cache: "no-store",
        signal,
        headers: {
          "content-type": "application/json",
          "idempotency-key": identity.idempotencyKey,
          "x-correlation-id": identity.correlationId,
        },
        body: JSON.stringify({ role: "admin" }),
      },
    );
  });

  it("propagates errors, rejects invalid payloads, and never retries a 401", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: "yes" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Sign in" }), { status: 401 }),
      );
    vi.stubGlobal("fetch", fetcher);

    await expect(
      membersApi.changeRole(userId, "viewer", identity),
    ).rejects.toMatchObject({ kind: "invalid_response" });
    await expect(
      membersApi.changeRole(userId, "viewer", identity),
    ).rejects.toMatchObject({ kind: "api", status: 401 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects a malformed member id before sending a request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    await expect(
      membersApi.changeRole("not-a-uuid", "viewer", identity),
    ).rejects.toMatchObject({ kind: "invalid_request" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
