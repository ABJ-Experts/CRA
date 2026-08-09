import { afterEach, describe, expect, it, vi } from "vitest";

import { rolesApi, rolesQueryKeys } from "./roles.api";

const role = {
  id: "a05570d6-aa75-4b6a-9688-b5a82eb3a774",
  name: "Auditor",
  description: null,
  color: "#4A50D6",
  baseRole: "viewer",
  permissions: { can_view_audit: true },
  isSystem: false,
  isActive: true,
  memberCount: 2,
} as const;

describe("rolesApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("exposes frozen stable query keys", () => {
    expect(rolesQueryKeys.list).toEqual(["roles"]);
    expect(rolesQueryKeys.overrides).toEqual(["roles", "overrides"]);
    expect(Object.isFrozen(rolesQueryKeys)).toBe(true);
    expect(Object.isFrozen(rolesQueryKeys.list)).toBe(true);
    expect(Object.isFrozen(rolesQueryKeys.overrides)).toBe(true);
  });

  it("lists roles with an authenticated GET and validates rows", async () => {
    const signal = new AbortController().signal;
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ rows: [role] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(rolesApi.list(signal)).resolves.toEqual({ rows: [role] });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith("/api/v1/roles", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: undefined,
      body: undefined,
    });
  });

  it("gets role overrides with an authenticated GET", async () => {
    const signal = new AbortController().signal;
    const response = {
      overrides: { owner: { can_view_audit: true } },
    };
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify(response), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(rolesApi.getOverrides(signal)).resolves.toEqual(response);
    expect(fetcher).toHaveBeenCalledWith("/api/v1/roles/overrides", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: undefined,
      body: undefined,
    });
  });

  it("sets a complete override with the exact mutation request", async () => {
    const signal = new AbortController().signal;
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(
      rolesApi.setOverride("admin", { can_view_audit: true }, signal),
    ).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith("/api/v1/roles/overrides", {
      method: "PUT",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseRole: "admin",
        permissions: { can_view_audit: true },
      }),
    });
  });

  it("propagates invalid responses and does not retry mutation 401s", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            rows: [{ ...role, permissions: { unknown_permission: true } }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ overrides: { superadmin: {} } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Sign in" }), { status: 401 }),
      );
    vi.stubGlobal("fetch", fetcher);

    await expect(rolesApi.list()).rejects.toMatchObject({
      kind: "invalid_response",
    });
    await expect(rolesApi.getOverrides()).rejects.toMatchObject({
      kind: "invalid_response",
    });
    await expect(rolesApi.setOverride("viewer", {})).rejects.toMatchObject({
      kind: "invalid_response",
    });
    await expect(rolesApi.setOverride("viewer", {})).rejects.toMatchObject({
      kind: "api",
      status: 401,
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
