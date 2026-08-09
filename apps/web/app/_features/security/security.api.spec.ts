import { afterEach, describe, expect, it, vi } from "vitest";

import { securityApi, securityQueryKeys } from "./security.api";

describe("securityApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("exposes frozen stable query keys", () => {
    expect(securityQueryKeys.factors).toEqual(["mfa", "factors"]);
    expect(securityQueryKeys.all).toEqual(["mfa"]);
    expect(Object.isFrozen(securityQueryKeys)).toBe(true);
    expect(Object.isFrozen(securityQueryKeys.factors)).toBe(true);
    expect(Object.isFrozen(securityQueryKeys.all)).toBe(true);
  });

  it("lists factors with an authenticated GET and signal", async () => {
    const signal = new AbortController().signal;
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ enrolled: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(securityApi.listFactors(signal)).resolves.toEqual({
      enrolled: true,
    });
    expect(fetcher).toHaveBeenCalledWith("/api/v1/auth/mfa/factors", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: undefined,
      body: undefined,
    });
  });

  it("starts enrollment with the exact POST and signal", async () => {
    const signal = new AbortController().signal;
    const response = {
      factorId: "factor-1",
      qrCode: "data:image/svg+xml;base64,abc",
      secret: "ABC123",
      uri: "otpauth://totp/CRA",
    };
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify(response), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(securityApi.enroll(signal)).resolves.toEqual(response);
    expect(fetcher).toHaveBeenCalledWith("/api/v1/auth/mfa/enroll", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: undefined,
      body: undefined,
    });
  });

  it("confirms enrollment with the exact POST body and signal", async () => {
    const signal = new AbortController().signal;
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ recoveryCodes: ["one", "two"] }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(
      securityApi.confirmEnrollment("factor-1", "123456", signal),
    ).resolves.toEqual({ recoveryCodes: ["one", "two"] });
    expect(fetcher).toHaveBeenCalledWith("/api/v1/auth/mfa/enroll/confirm", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ factorId: "factor-1", code: "123456" }),
    });
  });

  it("propagates invalid responses and never retries mutation 401s", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ enrolled: "yes" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Sign in" }), { status: 401 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Sign in" }), { status: 401 }),
      );
    vi.stubGlobal("fetch", fetcher);

    await expect(securityApi.listFactors()).rejects.toMatchObject({
      kind: "invalid_response",
    });
    await expect(securityApi.enroll()).rejects.toMatchObject({
      kind: "api",
      status: 401,
    });
    await expect(
      securityApi.confirmEnrollment("factor-1", "123456"),
    ).rejects.toMatchObject({ kind: "api", status: 401 });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("rejects a malformed confirmation code before sending a request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    await expect(
      securityApi.confirmEnrollment("factor-1", "123"),
    ).rejects.toMatchObject({ kind: "invalid_request" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
