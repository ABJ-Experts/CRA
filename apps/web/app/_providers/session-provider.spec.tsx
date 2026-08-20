// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mocksReady = true;

vi.mock("./providers", () => ({
  useMocksReady: () => mocksReady,
}));

import {
  Can,
  SessionProvider,
  useCanViewMenu,
  useSession,
} from "./session-provider";

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

const permissions = {
  organizationId: "22222222-2222-4222-8222-222222222222",
  role: "viewer",
  permissions: { can_view_orders: true },
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function responseFor(path: string): Response {
  switch (path) {
    case "/api/v1/auth/session":
      return jsonResponse(session);
    case "/api/v1/permissions/effective":
      return jsonResponse(permissions);
    case "/api/v1/permissions/menu":
      return jsonResponse({ menu: ["dashboard", "organization"] });
    default:
      throw new Error(`unexpected request: ${path}`);
  }
}

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderSession(children: ReactNode, client = makeClient()) {
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider>{children}</SessionProvider>
    </QueryClientProvider>,
  );
}

function StateProbe() {
  const state = useSession();
  const canViewMenu = useCanViewMenu();

  return (
    <output
      data-testid="state"
      data-loading={String(state.isLoading)}
      data-error={String(state.isError)}
      data-menu={state.menu === null ? "unknown" : state.menu.join(",")}
      data-dashboard={String(canViewMenu("dashboard"))}
      data-organization={String(canViewMenu("organization"))}
      data-management={String(canViewMenu("management"))}
    >
      <Can permission="can_view_orders" fallback="denied">
        allowed
      </Can>
    </output>
  );
}

beforeEach(() => {
  mocksReady = true;
  vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "false");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SessionProvider", () => {
  it("does not query before the mocks readiness gate opens", async () => {
    mocksReady = false;
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      responseFor(String(input)),
    );
    vi.stubGlobal("fetch", fetcher);

    const client = makeClient();
    const view = renderSession(<StateProbe />, client);
    await act(async () => Promise.resolve());
    expect(fetcher).not.toHaveBeenCalled();

    mocksReady = true;
    view.rerender(
      <QueryClientProvider client={client}>
        <SessionProvider>
          <StateProbe />
        </SessionProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  });

  it("issues zero session requests while application mocks are enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "true");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    renderSession(<StateProbe />);
    await act(async () => Promise.resolve());

    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByTestId("state").getAttribute("data-loading")).toBe(
      "false",
    );
  });


  it("keeps the menu complete while the initial live session requests load", async () => {
    const releases = new Map<string, (response: Response) => void>();
    const fetcher = vi.fn(
      (input: RequestInfo | URL) =>
        new Promise<Response>((resolve) => {
          releases.set(String(input), resolve);
        }),
    );
    vi.stubGlobal("fetch", fetcher);

    renderSession(<StateProbe />);

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    expect(new Set(releases.keys())).toEqual(
      new Set([
        "/api/v1/auth/session",
        "/api/v1/permissions/effective",
        "/api/v1/permissions/menu",
      ]),
    );
    expect(screen.getByTestId("state").getAttribute("data-dashboard")).toBe(
      "true",
    );
    expect(screen.getByTestId("state").getAttribute("data-organization")).toBe(
      "true",
    );

    await act(async () => {
      for (const [path, release] of releases) release(responseFor(path));
    });
  });

  it("fails open through the shared menu contract when one request fails", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      return path === "/api/v1/permissions/menu"
        ? jsonResponse({ message: "unavailable" }, 503)
        : responseFor(path);
    });
    vi.stubGlobal("fetch", fetcher);

    renderSession(<StateProbe />);

    await waitFor(() =>
      expect(screen.getByTestId("state").getAttribute("data-error")).toBe(
        "true",
      ),
    );
    const state = screen.getByTestId("state");
    expect(state.getAttribute("data-menu")).toBe("unknown");
    expect(state.getAttribute("data-dashboard")).toBe("true");
    expect(state.getAttribute("data-organization")).toBe("false");
    expect(state.getAttribute("data-management")).toBe("false");
    expect(state.textContent).toContain("allowed");
  });

  it("preserves a known empty server menu instead of falling back locally", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      return path === "/api/v1/permissions/menu"
        ? jsonResponse({ menu: [] })
        : responseFor(path);
    });
    vi.stubGlobal("fetch", fetcher);

    renderSession(<StateProbe />);

    await waitFor(() =>
      expect(screen.getByTestId("state").getAttribute("data-loading")).toBe(
        "false",
      ),
    );
    const state = screen.getByTestId("state");
    expect(state.getAttribute("data-menu")).toBe("");
    expect(state.getAttribute("data-organization")).toBe("false");
    expect(state.textContent).toContain("allowed");
  });

  it("uses the authoritative server menu once it is known", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      return path === "/api/v1/permissions/menu"
        ? jsonResponse({ menu: ["dashboard"] })
        : responseFor(path);
    });
    vi.stubGlobal("fetch", fetcher);

    renderSession(<StateProbe />);

    await waitFor(() =>
      expect(screen.getByTestId("state").getAttribute("data-loading")).toBe(
        "false",
      ),
    );
    expect(screen.getByTestId("state").getAttribute("data-organization")).toBe(
      "false",
    );
  });

  it("does not share cached session data between independent render clients", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      responseFor(String(input)),
    );
    vi.stubGlobal("fetch", fetcher);

    const first = renderSession(<StateProbe />, makeClient());
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    first.unmount();

    renderSession(<StateProbe />, makeClient());
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(6));
  });
});
