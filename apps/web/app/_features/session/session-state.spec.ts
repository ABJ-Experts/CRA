import type { SessionResponse } from "@repo/contracts/auth/types";
import { describe, expect, it } from "vitest";

import { deriveSessionState } from "./session-state";

describe("deriveSessionState", () => {
  it("keeps menu unknown while loading or failed", () => {
    expect(
      deriveSessionState({
        enabled: true,
        session: null,
        permissions: null,
        menu: null,
        loading: true,
        error: false,
      }),
    ).toMatchObject({ menu: null, isLoading: true });
    expect(
      deriveSessionState({
        enabled: true,
        session: null,
        permissions: null,
        menu: null,
        loading: false,
        error: true,
      }),
    ).toMatchObject({ menu: null, isError: true });
  });

  it("does not collapse an explicitly empty known menu into unknown", () => {
    expect(
      deriveSessionState({
        enabled: true,
        session: null,
        permissions: { role: "viewer", permissions: {} },
        menu: [],
        loading: false,
        error: false,
      }).menu,
    ).toEqual([]);
  });

  it("disables all remote loading/error state while mocks are enabled", () => {
    expect(
      deriveSessionState({
        enabled: false,
        session: null,
        permissions: null,
        menu: null,
        loading: true,
        error: true,
      }),
    ).toMatchObject({ isLoading: false, isError: false, menu: null });
  });

  it("does not expose partial menu data while another session query is pending or failed", () => {
    expect(
      deriveSessionState({
        enabled: true,
        session: null,
        permissions: null,
        menu: ["dashboard"],
        loading: true,
        error: false,
      }).menu,
    ).toBeNull();
    expect(
      deriveSessionState({
        enabled: true,
        session: null,
        permissions: null,
        menu: ["dashboard"],
        loading: false,
        error: true,
      }).menu,
    ).toBeNull();
  });

  it("returns fresh values so callers cannot mutate query cache data", () => {
    const permissions = {
      organizationId: "22222222-2222-4222-8222-222222222222",
      role: "viewer" as const,
      permissions: { can_view_orders: true },
    };
    const menu = ["dashboard", "ecommerce.orders"] as const;

    const state = deriveSessionState({
      enabled: true,
      session: null,
      permissions,
      menu,
      loading: false,
      error: false,
    });

    expect(state.permissions).toEqual(permissions.permissions);
    expect(state.permissions).not.toBe(permissions.permissions);
    expect(state.menu).toEqual(menu);
    expect(state.menu).not.toBe(menu);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.permissions)).toBe(true);
    expect(Object.isFrozen(state.menu)).toBe(true);
  });

  it("copies and freezes every session object and organization array", () => {
    const session = {
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "person@example.com",
        username: null,
        firstName: null,
        lastName: null,
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
    } satisfies SessionResponse;

    const state = deriveSessionState({
      enabled: true,
      session,
      permissions: null,
      menu: [],
      loading: false,
      error: false,
    });

    expect(state.session).toEqual(session);
    expect(state.session).not.toBe(session);
    expect(Object.isFrozen(state.session)).toBe(true);
    expect(Object.isFrozen(state.session?.user)).toBe(true);
    expect(Object.isFrozen(state.session?.organization)).toBe(true);
    expect(Object.isFrozen(state.session?.organizations)).toBe(true);
    expect(Object.isFrozen(state.session?.organizations[0])).toBe(true);
    expect(state.session?.organizations).not.toBe(session.organizations);
  });
});
