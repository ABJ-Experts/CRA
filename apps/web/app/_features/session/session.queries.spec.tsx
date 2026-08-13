// @vitest-environment jsdom

import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sessionApi } from "./session.api";
import { sessionKeys } from "./session.keys";
import {
  SESSION_STALE_TIME_MS,
  sessionIdentityQueryOptions,
  sessionMenuQueryOptions,
  sessionPermissionsQueryOptions,
} from "./session.queries";
import { Providers } from "../../_providers/providers";

const session = {
  user: {
    id: "11111111-1111-4111-8111-111111111111",
    email: "person@example.com",
    username: "person",
    firstName: "Pat",
    lastName: "Example",
    avatarUrl: null,
    isActive: true,
  },
  organization: {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Example",
    slug: "example",
    role: "viewer",
  },
  organizations: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Example",
      slug: "example",
      role: "viewer",
    },
  ],
};

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("sessionApi", () => {
  it("validates each session endpoint and returns its domain value", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      switch (String(input)) {
        case "/api/v1/auth/session":
          return jsonResponse(session);
        case "/api/v1/permissions/effective":
          return jsonResponse({
            organizationId: "22222222-2222-4222-8222-222222222222",
            role: "viewer",
            permissions: { can_view_orders: true },
          });
        case "/api/v1/permissions/menu":
          return jsonResponse({ menu: ["dashboard", "organization"] });
        case "/api/v1/auth/sign-out":
          return jsonResponse({ ok: true });
        default:
          throw new Error("unexpected request");
      }
    });

    await expect(sessionApi.identity({ fetcher })).resolves.toEqual(session);
    await expect(sessionApi.permissions({ fetcher })).resolves.toEqual({
      organizationId: "22222222-2222-4222-8222-222222222222",
      role: "viewer",
      permissions: { can_view_orders: true },
    });
    await expect(sessionApi.menu({ fetcher })).resolves.toEqual([
      "dashboard",
      "organization",
    ]);
    await expect(sessionApi.signOut({ fetcher })).resolves.toEqual({
      ok: true,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/auth/sign-out",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it.each([
    ["identity", { ...session, unexpected: true }],
    [
      "identity",
      {
        ...session,
        organization: { ...session.organization, role: "superadmin" },
      },
    ],
    [
      "permissions",
      {
        organizationId: "22222222-2222-4222-8222-222222222222",
        role: "viewer",
        permissions: { can_invent_permissions: true },
      },
    ],
    ["menu", { menu: ["not.a.real.menu"] }],
  ] as const)("rejects an invalid %s response", async (endpoint, body) => {
    const fetcher = vi.fn(async () => jsonResponse(body));

    await expect(sessionApi[endpoint]({ fetcher })).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  it("forwards cancellation to the HTTP boundary", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => jsonResponse(session));

    await sessionApi.identity({ signal: controller.signal, fetcher });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/auth/session",
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});

describe("session query option factories", () => {
  it("publishes stable, frozen query keys", () => {
    expect(sessionKeys).toEqual({
      all: ["session"],
      identity: ["session", "identity"],
      permissions: ["session", "permissions"],
      menu: ["session", "permissions", "menu"],
    });
    expect(Object.isFrozen(sessionKeys)).toBe(true);
    expect(Object.values(sessionKeys).every(Object.isFrozen)).toBe(true);
  });

  it.each([
    [sessionIdentityQueryOptions, sessionKeys.identity],
    [sessionPermissionsQueryOptions, sessionKeys.permissions],
    [sessionMenuQueryOptions, sessionKeys.menu],
  ] as const)("retains the session cache and retry policy", (factory, key) => {
    const options = factory(false);

    expect(options).toMatchObject({
      queryKey: key,
      enabled: false,
      retry: false,
      staleTime: SESSION_STALE_TIME_MS,
    });
  });

  it("keeps independent clients from sharing cached session identity", async () => {
    const fetcher = vi.fn(async () => jsonResponse(session));
    const first = new QueryClient();
    const second = new QueryClient();

    await first.fetchQuery({
      ...sessionIdentityQueryOptions(true),
      queryFn: () => sessionApi.identity({ fetcher }),
    });
    await second.fetchQuery({
      ...sessionIdentityQueryOptions(true),
      queryFn: () => sessionApi.identity({ fetcher }),
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("creates an isolated query client for every server render", () => {
    const clients: QueryClient[] = [];
    function CaptureClient() {
      clients.push(useQueryClient());
      return null;
    }
    vi.stubGlobal("window", undefined);

    renderToString(
      <Providers>
        <CaptureClient />
      </Providers>,
    );
    renderToString(
      <Providers>
        <CaptureClient />
      </Providers>,
    );

    expect(clients).toHaveLength(2);
    expect(clients[0]).not.toBe(clients[1]);
  });
});
