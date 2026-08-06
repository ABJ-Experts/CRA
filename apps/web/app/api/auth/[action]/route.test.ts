import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  passwordGrant: vi.fn(),
  writeSession: vi.fn(),
}));

vi.mock("../../../../lib/gotrue", () => ({
  passwordGrant: mocks.passwordGrant,
  signUp: vi.fn(),
  requestPasswordReset: vi.fn(),
  signOut: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("../../../../lib/session", () => ({
  clearSession: vi.fn(),
  readSession: vi.fn(),
  writeSession: mocks.writeSession,
}));

import { POST } from "./route";

const signInParams = { params: Promise.resolve({ action: "sign-in" }) };

describe("POST /api/auth/sign-in", () => {
  beforeEach(() => {
    mocks.passwordGrant.mockReset();
    mocks.writeSession.mockReset();
  });

  it("supports a native form POST and redirects after writing the httpOnly session", async () => {
    const session = {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: 1_800_000_000,
    };
    mocks.passwordGrant.mockResolvedValue({ ok: true, session });

    const response = await POST(
      new Request("http://localhost:3000/api/auth/sign-in", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          identifier: "admin@example.com",
          password: "not-in-the-url",
        }),
      }),
      signInParams,
    );

    expect(mocks.passwordGrant).toHaveBeenCalledWith("admin@example.com", "not-in-the-url");
    expect(mocks.writeSession).toHaveBeenCalledWith(session);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/select-organisation");
  });

  it("redirects failed native form posts with a generic error and never echoes credentials", async () => {
    mocks.passwordGrant.mockResolvedValue({
      ok: false,
      message: "That email and password do not match.",
    });

    const response = await POST(
      new Request("http://localhost:3000/api/auth/sign-in", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          identifier: "admin@example.com",
          password: "not-in-the-url",
        }),
      }),
      signInParams,
    );

    const location = response.headers.get("location") ?? "";
    expect(response.status).toBe(303);
    expect(location).toBe("http://localhost:3000/sign-in?error=invalid_credentials");
    expect(location).not.toContain("admin@example.com");
    expect(location).not.toContain("not-in-the-url");
  });

  it("preserves the JSON client contract for hydrated sign-in", async () => {
    const session = {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: 1_800_000_000,
    };
    mocks.passwordGrant.mockResolvedValue({ ok: true, session });

    const response = await POST(
      new Request("http://localhost:3000/api/auth/sign-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "admin@example.com", password: "client-password" }),
      }),
      signInParams,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      next: "/select-organisation",
    });
  });
});
