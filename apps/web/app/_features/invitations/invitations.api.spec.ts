import { afterEach, describe, expect, it, vi } from "vitest";

import { invitationsApi } from "./invitations.api";

describe("invitationsApi", () => {
  const token = "t".repeat(32);
  afterEach(() => vi.unstubAllGlobals());

  it("accepts an invitation with the exact request and signal", async () => {
    const signal = new AbortController().signal;
    const response = {
      ok: true,
      alreadyAccepted: false,
      organization: {
        id: "a05570d6-aa75-4b6a-9688-b5a82eb3a774",
        name: "Analytical Engines",
        slug: "analytical-engines",
      },
    } as const;
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify(response), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(invitationsApi.accept(token, signal)).resolves.toEqual(
      response,
    );
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith("/api/v1/invitations/accept", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
  });

  it("propagates errors, validates the shared response, and never retries a 401", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Sign in" }), { status: 401 }),
      );
    vi.stubGlobal("fetch", fetcher);

    await expect(invitationsApi.accept(token)).rejects.toMatchObject({
      kind: "invalid_response",
    });
    await expect(invitationsApi.accept(token)).rejects.toMatchObject({
      kind: "api",
      status: 401,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects a malformed token before sending a request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    await expect(invitationsApi.accept("short")).rejects.toMatchObject({
      kind: "invalid_request",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
