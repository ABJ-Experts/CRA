import { afterEach, describe, expect, it, vi } from "vitest";

import { accountApi } from "./account.api";

const identity = {
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  correlationId: "22222222-2222-4222-8222-222222222222",
} as const;

describe("accountApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("updates the profile with the exact request and signal", async () => {
    const signal = new AbortController().signal;
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(
      accountApi.updateProfile(
        { firstName: "Ada", lastName: "Lovelace", jobTitle: "Engineer" },
        identity,
        signal,
      ),
    ).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith("/api/v1/users/me", {
      method: "PATCH",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: {
        "content-type": "application/json",
        "idempotency-key": identity.idempotencyKey,
        "x-correlation-id": identity.correlationId,
      },
      body: JSON.stringify({
        firstName: "Ada",
        lastName: "Lovelace",
        jobTitle: "Engineer",
      }),
    });
  });

  it("propagates errors, rejects invalid payloads, and never retries a 401", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Sign in" }), { status: 401 }),
      );
    vi.stubGlobal("fetch", fetcher);

    await expect(accountApi.updateProfile({}, identity)).rejects.toMatchObject({
      kind: "invalid_response",
    });
    await expect(accountApi.updateProfile({}, identity)).rejects.toMatchObject({
      kind: "api",
      status: 401,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
