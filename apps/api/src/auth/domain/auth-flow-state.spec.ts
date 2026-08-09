import { routeForAuthHint, transitionAuthFlow } from "./auth-flow-state";

describe("auth flow state", () => {
  it("moves only through transitions backed by verified server facts", () => {
    const pending = transitionAuthFlow(
      { kind: "anonymous" },
      { kind: "registration_created", userId: "user-1" },
    );
    expect(pending).toEqual({
      ok: true,
      value: { kind: "pending_email", userId: "user-1" },
    });

    expect(
      transitionAuthFlow(pending.ok ? pending.value : { kind: "anonymous" }, {
        kind: "email_verified",
        userId: "user-1",
      }),
    ).toEqual({
      ok: true,
      value: { kind: "authenticated", userId: "user-1", aal: "aal1" },
    });

    expect(
      transitionAuthFlow(
        { kind: "anonymous" },
        {
          kind: "credentials_verified",
          userId: "user-1",
          requiresMfa: true,
        },
      ),
    ).toEqual({
      ok: true,
      value: { kind: "mfa_required", userId: "user-1" },
    });

    expect(
      transitionAuthFlow(
        { kind: "mfa_required", userId: "user-1" },
        { kind: "mfa_verified", userId: "user-1" },
      ),
    ).toEqual({
      ok: true,
      value: { kind: "authenticated", userId: "user-1", aal: "aal2" },
    });
  });

  it("restores state only from a server-verified session fact", () => {
    expect(
      transitionAuthFlow(
        { kind: "anonymous" },
        { kind: "session_verified", userId: "user-1", aal: "aal2" },
      ),
    ).toEqual({
      ok: true,
      value: { kind: "authenticated", userId: "user-1", aal: "aal2" },
    });
  });

  it("rejects cross-user and out-of-order transitions", () => {
    expect(
      transitionAuthFlow(
        { kind: "pending_email", userId: "user-1" },
        { kind: "email_verified", userId: "user-2" },
      ),
    ).toMatchObject({ ok: false });
    expect(
      transitionAuthFlow(
        { kind: "anonymous" },
        { kind: "mfa_verified", userId: "user-1" },
      ),
    ).toMatchObject({ ok: false });
    expect(
      transitionAuthFlow(
        {
          kind: "locked",
          email: "member@cra.test",
          until: "2026-08-09T12:00:00.000Z",
        },
        {
          kind: "credentials_verified",
          userId: "user-1",
          requiresMfa: false,
        },
      ),
    ).toMatchObject({ ok: false });
  });

  it("models lock application, expiry, and sign-out explicitly", () => {
    const locked = transitionAuthFlow(
      { kind: "anonymous" },
      {
        kind: "lock_applied",
        email: "member@cra.test",
        until: "2026-08-09T12:00:00.000Z",
      },
    );
    expect(locked).toMatchObject({ ok: true, value: { kind: "locked" } });
    expect(
      transitionAuthFlow(locked.ok ? locked.value : { kind: "anonymous" }, {
        kind: "lock_expired",
      }),
    ).toEqual({ ok: true, value: { kind: "anonymous" } });
    expect(
      transitionAuthFlow(
        { kind: "authenticated", userId: "user-1", aal: "aal2" },
        { kind: "signed_out" },
      ),
    ).toEqual({ ok: true, value: { kind: "anonymous" } });
  });

  it.each([
    ["cra_pending", "/verify-email"],
    ["cra_mfa", "/two-factor"],
    ["cra_session", "/dashboard"],
  ] as const)("treats %s as a routing hint only", (hint, route) => {
    const decision = routeForAuthHint(hint);

    expect(decision).toEqual({ kind: "route_hint", route });
    expect(decision).not.toHaveProperty("userId");
    expect(decision).not.toHaveProperty("aal");
  });

  it("ignores unknown browser hints", () => {
    expect(routeForAuthHint("forged_authenticated")).toEqual({
      kind: "no_hint",
    });
  });
});
