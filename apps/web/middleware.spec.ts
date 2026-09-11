import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jose = vi.hoisted(() => ({
  createRemoteJWKSet: vi.fn(() => "test-jwks"),
  decodeProtectedHeader: vi.fn<(token: string) => { alg?: string }>(),
  jwtVerify: vi.fn(),
}));

vi.mock("jose", () => jose);

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function tokenWithExpiry(exp: number, alg = "HS256"): string {
  return `${encode({ alg, typ: "JWT" })}.${encode({ exp })}.signature`;
}

async function loadMiddleware(
  options: Readonly<{
    nodeEnv?: "development" | "production";
    mocks?: "true" | "false";
    secret?: string;
  }> = {},
) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", options.nodeEnv ?? "production");
  vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", options.mocks ?? "false");
  vi.stubEnv("SUPABASE_JWT_SECRET", options.secret ?? "test-secret");
  return import("./middleware");
}

beforeEach(() => {
  jose.createRemoteJWKSet.mockClear();
  jose.decodeProtectedHeader.mockReset();
  jose.decodeProtectedHeader.mockReturnValue({ alg: "HS256" });
  jose.jwtVerify.mockReset();
  jose.jwtVerify.mockResolvedValue({ payload: {} });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("refresh targets", () => {
  it("keeps token refresh on the web origin and preserves the full query", async () => {
    const { createRefreshTarget } = await loadMiddleware();
    const request = new NextRequest(
      "http://localhost:3000/dashboard?tab=security&filter=needs%20review",
    );

    expect(createRefreshTarget(request).toString()).toBe(
      "http://localhost:3000/api/v1/auth/refresh?redirectTo=%2Fdashboard%3Ftab%3Dsecurity%26filter%3Dneeds%2520review",
    );
  });

  it("treats an external-looking query value as data, not an open redirect", async () => {
    const { createRefreshTarget } = await loadMiddleware();
    const request = new NextRequest(
      "https://app.cra.test/dashboard?returnUrl=https%3A%2F%2Fevil.test%2Fsteal",
    );
    const target = createRefreshTarget(request);
    const redirectTo = target.searchParams.get("redirectTo");

    expect(target.origin).toBe("https://app.cra.test");
    expect(target.pathname).toBe("/api/v1/auth/refresh");
    expect(redirectTo).toBe(
      "/dashboard?returnUrl=https%3A%2F%2Fevil.test%2Fsteal",
    );
    expect(new URL(redirectTo!, target).origin).toBe(target.origin);
  });
});

describe("refresh routing", () => {
  it.each([
    [true, "expired", false, true],
    [true, "absent", true, true],
    [true, "absent", false, false],
    [true, "invalid", true, false],
    [false, "expired", true, false],
  ] as const)(
    "decides protected=%s state=%s marker=%s",
    async (isProtected, state, marker, expected) => {
      const { shouldAttemptRefresh } = await loadMiddleware();
      expect(shouldAttemptRefresh(isProtected, state, marker)).toBe(expected);
    },
  );
});

describe("token inspection fallbacks", () => {
  it.each(["none", "HS512", undefined])(
    "rejects unsupported algorithm %s before verification or fallback",
    async (alg) => {
      jose.decodeProtectedHeader.mockReturnValue({ alg });
      jose.jwtVerify.mockRejectedValue({ code: "ERR_JOSE_GENERIC" });
      const { inspectToken } = await loadMiddleware({ secret: "" });
      const token = tokenWithExpiry(Math.floor(Date.now() / 1000) + 60);

      await expect(inspectToken(token)).resolves.toBe("invalid");
      expect(jose.jwtVerify).not.toHaveBeenCalled();
    },
  );

  it("uses the unsigned expiry only when an HS256 secret is absent", async () => {
    const { inspectToken } = await loadMiddleware({ secret: "" });
    const future = tokenWithExpiry(Math.floor(Date.now() / 1000) + 60);
    const past = tokenWithExpiry(Math.floor(Date.now() / 1000) - 60);

    await expect(inspectToken(future)).resolves.toBe("valid");
    await expect(inspectToken(past)).resolves.toBe("expired");
    expect(jose.jwtVerify).not.toHaveBeenCalled();
  });

  it.each(["ERR_JWKS_TIMEOUT", "ERR_JWKS_NO_MATCHING_KEY", "ERR_JOSE_GENERIC"])(
    "falls back to expiry during a JWKS outage (%s)",
    async (code) => {
      jose.decodeProtectedHeader.mockReturnValue({ alg: "ES256" });
      jose.jwtVerify.mockRejectedValue({ code });
      const { inspectToken } = await loadMiddleware();
      const token = tokenWithExpiry(
        Math.floor(Date.now() / 1000) + 60,
        "ES256",
      );

      await expect(inspectToken(token)).resolves.toBe("valid");
    },
  );

  it("does not downgrade an invalid signature to the expiry fallback", async () => {
    jose.decodeProtectedHeader.mockReturnValue({ alg: "ES256" });
    jose.jwtVerify.mockRejectedValue({
      code: "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
    });
    const { inspectToken } = await loadMiddleware();
    const token = tokenWithExpiry(Math.floor(Date.now() / 1000) + 60, "ES256");

    await expect(inspectToken(token)).resolves.toBe("invalid");
  });
});

describe("middleware integration", () => {
  it("allows an ES256 JWKS-verified session through a protected SBOM product route", async () => {
    jose.decodeProtectedHeader.mockReturnValue({ alg: "ES256" });
    const token = tokenWithExpiry(Math.floor(Date.now() / 1000) + 60, "ES256");
    const { middleware } = await loadMiddleware();
    const response = await middleware(
      new NextRequest("https://app.cra.test/products/product-123", {
        headers: { cookie: `cra_at=${token}` },
      }),
    );

    expect(response.headers.get("location")).toBeNull();
    expect(jose.jwtVerify).toHaveBeenCalledWith(token, "test-jwks", {
      issuer: "http://127.0.0.1:54321/auth/v1",
    });
  });

  it("maps an expired-away protected session to the refresh endpoint", async () => {
    const { middleware } = await loadMiddleware();
    const response = await middleware(
      new NextRequest("https://app.cra.test/dashboard?tab=security", {
        headers: { cookie: "cra_session=1" },
      }),
    );

    expect(response.headers.get("location")).toBe(
      "https://app.cra.test/api/v1/auth/refresh?redirectTo=%2Fdashboard%3Ftab%3Dsecurity",
    );
  });

  it("maps SBOM product routes with a session marker to the narrow refresh endpoint", async () => {
    const { middleware } = await loadMiddleware();
    const response = await middleware(
      new NextRequest(
        "https://app.cra.test/products/product-123?releaseId=release-123&sbomSource=source-123",
        {
          headers: { cookie: "cra_session=1" },
        },
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://app.cra.test/api/v1/auth/refresh?redirectTo=%2Fproducts%2Fproduct-123%3FreleaseId%3Drelease-123%26sbomSource%3Dsource-123",
    );
  });

  it("preserves the protected URL and query in the sign-in returnUrl", async () => {
    const { middleware } = await loadMiddleware();
    const response = await middleware(
      new NextRequest(
        "https://app.cra.test/dashboard?tab=security&next=https%3A%2F%2Fevil.test",
      ),
    );
    const location = new URL(response.headers.get("location")!);

    expect(location.origin).toBe("https://app.cra.test");
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("returnUrl")).toBe(
      "/dashboard?tab=security&next=https%3A%2F%2Fevil.test",
    );
  });

  it("clears an invalid access cookie and redirects to same-origin sign-in", async () => {
    jose.decodeProtectedHeader.mockImplementation(() => {
      throw new Error("malformed token");
    });
    const { middleware } = await loadMiddleware();
    const response = await middleware(
      new NextRequest("https://app.cra.test/dashboard", {
        headers: { cookie: "cra_at=malformed; cra_session=1" },
      }),
    );

    expect(response.headers.get("location")).toBe(
      "https://app.cra.test/sign-in",
    );
    expect(response.headers.get("set-cookie")).toContain("cra_at=");
    expect(response.headers.get("set-cookie")).not.toContain("cra_session=");
  });

  it("maps pending email and MFA decisions in precedence order", async () => {
    const { middleware } = await loadMiddleware();
    const pending = await middleware(
      new NextRequest("https://app.cra.test/dashboard?discarded=true", {
        headers: { cookie: "cra_at=valid; cra_pending=1; cra_mfa=1" },
      }),
    );
    const mfa = await middleware(
      new NextRequest("https://app.cra.test/dashboard?discarded=true", {
        headers: { cookie: "cra_at=valid; cra_mfa=1" },
      }),
    );

    expect(pending.headers.get("location")).toBe("https://app.cra.test/verify");
    expect(mfa.headers.get("location")).toBe("https://app.cra.test/two-factor");
  });

  it("maps a valid auth-page session to the dashboard", async () => {
    const { middleware } = await loadMiddleware();
    const response = await middleware(
      new NextRequest("https://app.cra.test/sign-in?discarded=true", {
        headers: { cookie: "cra_at=valid" },
      }),
    );

    expect(response.headers.get("location")).toBe(
      "https://app.cra.test/dashboard",
    );
  });

  it.each([
    ["/verify", "cra_at=valid; cra_pending=1"],
    ["/two-factor", "cra_at=valid; cra_mfa=1"],
    ["/lock", "cra_at=valid"],
    ["/success", "cra_at=valid"],
  ])("keeps the %s flow exception reachable", async (pathname, cookie) => {
    const { middleware } = await loadMiddleware();
    const response = await middleware(
      new NextRequest(`https://app.cra.test${pathname}`, {
        headers: { cookie },
      }),
    );

    expect(response.headers.get("location")).toBeNull();
  });

  it("allows a valid session through a nested protected route", async () => {
    const { middleware } = await loadMiddleware();
    const response = await middleware(
      new NextRequest("https://app.cra.test/dashboard/security", {
        headers: { cookie: "cra_at=valid" },
      }),
    );

    expect(response.headers.get("location")).toBeNull();
  });

  it.each([
    ["/management", "/management"],
    ["/organization", "/organization"],
    ["/connectors", "/connectors"],
    [
      "/connectors/00000000-0000-4000-8000-000000000001",
      "/connectors/00000000-0000-4000-8000-000000000001",
    ],
    ["/products", "/products"],
    ["/products/product-123", "/products/product-123"],
    ["/account", "/account"],
    ["/security", "/security"],
    ["/roles", "/roles"],
    ["/permissions", "/permissions"],
    ["/onboarding?stage=organization", "/onboarding?stage=organization"],
  ] as const)(
    "protects the canonical customer path %s",
    async (pathname, returnUrl) => {
      const { middleware } = await loadMiddleware();
      const response = await middleware(
        new NextRequest(`https://app.cra.test${pathname}`),
      );

      expect(response.headers.get("location")).toBe(
        `https://app.cra.test/sign-in?returnUrl=${encodeURIComponent(returnUrl)}`,
      );
    },
  );

  it("bypasses route gating while development mocks are enabled", async () => {
    const { middleware } = await loadMiddleware({
      nodeEnv: "development",
      mocks: "true",
    });
    const response = await middleware(
      new NextRequest("http://localhost:3000/dashboard"),
    );

    expect(response.headers.get("location")).toBeNull();
  });

  it("forces route gating in production even if mocks were enabled", async () => {
    const { middleware } = await loadMiddleware({
      nodeEnv: "production",
      mocks: "true",
    });
    const response = await middleware(
      new NextRequest("https://app.cra.test/dashboard"),
    );

    expect(response.headers.get("location")).toBe(
      "https://app.cra.test/sign-in?returnUrl=%2Fdashboard",
    );
  });
});
