import {
  ACCESS_COOKIE,
  API_PREFIX,
  MFA_COOKIE,
  PENDING_COOKIE,
  REMEMBER_ME_COOKIE,
  REMEMBER_ME_COOKIE_PATH,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  SESSION_MARKER_COOKIE,
  clearSessionCookies,
  readRememberMeCookie,
  setSessionCookies,
  sign,
  unsign,
} from "./cookies.util";

interface Recorded {
  name: string;
  value: string;
  options: Record<string, unknown>;
}

function fakeResponse() {
  const set: Recorded[] = [];
  const cleared: Recorded[] = [];
  return {
    set,
    cleared,
    cookie(name: string, value: string, options: Record<string, unknown>) {
      set.push({ name, value, options });
    },
    clearCookie(name: string, options: Record<string, unknown>) {
      cleared.push({ name, value: "", options });
    },
  };
}

const cfg = {
  domain: "",
  secure: false,
  sameSite: "lax" as const,
  accessMaxAge: 3600,
  refreshMaxAge: 604800,
  signingSecret: "test-signing-secret-at-least-16",
};

describe("cookie contract", () => {
  it("derives the refresh path from the global prefix", () => {
    // If these drift, the browser stops sending the refresh token and every
    // session dies silently one access-token lifetime after sign-in.
    expect(REFRESH_COOKIE_PATH).toBe(`/${API_PREFIX}/auth/refresh`);
    expect(API_PREFIX).toBe("api/v1");
  });

  it("keeps refresh cookies off SBOM upload and validation API paths", () => {
    expect(REFRESH_COOKIE_PATH).toBe("/api/v1/auth/refresh");
    const sbomApiPaths = [
      "/api/v1/products/product-1/releases/release-1/sbom-uploads",
      "/api/v1/sbom-sources/source-1/validation-report",
    ] as const;

    for (const path of sbomApiPaths) {
      expect(path.startsWith(REFRESH_COOKIE_PATH)).toBe(false);
    }
    expect(REFRESH_COOKIE_PATH).not.toBe("/");
    expect(REFRESH_COOKIE_PATH).not.toBe(`/${API_PREFIX}`);
  });

  it("sets both session cookies HttpOnly, with the refresh one path-scoped", () => {
    const res = fakeResponse();
    setSessionCookies(
      res as never,
      { access_token: "a.b.c", refresh_token: "r" },
      cfg,
      {
        rememberMe: true,
      },
    );

    const access = res.set.find((c) => c.name === ACCESS_COOKIE);
    const refresh = res.set.find((c) => c.name === REFRESH_COOKIE);

    expect(access?.options).toMatchObject({
      httpOnly: true,
      path: "/",
      sameSite: "lax",
    });
    expect(access?.options.maxAge).toBe(3600 * 1000);

    // The narrow path IS the CSRF control, not an optimisation.
    expect(refresh?.options).toMatchObject({
      httpOnly: true,
      path: REFRESH_COOKIE_PATH,
    });
    expect(refresh?.options.maxAge).toBe(604800 * 1000);
  });

  it("makes the refresh cookie session-scoped without remember-me", () => {
    const res = fakeResponse();
    setSessionCookies(
      res as never,
      { access_token: "a", refresh_token: "r" },
      cfg,
    );
    const refresh = res.set.find((c) => c.name === REFRESH_COOKIE);
    expect(refresh?.options.maxAge).toBeUndefined();
  });

  it("keeps the remember-me preference in a signed auth-scoped cookie", () => {
    const persistent = fakeResponse();
    setSessionCookies(
      persistent as never,
      { access_token: "a", refresh_token: "r" },
      cfg,
      { rememberMe: true },
    );

    const persistentMarker = persistent.set.find(
      (cookie) => cookie.name === REMEMBER_ME_COOKIE,
    );
    expect(persistentMarker?.options).toMatchObject({
      httpOnly: true,
      path: REMEMBER_ME_COOKIE_PATH,
      maxAge: cfg.refreshMaxAge * 1000,
    });
    expect(
      readRememberMeCookie(
        { [REMEMBER_ME_COOKIE]: persistentMarker?.value },
        cfg,
      ),
    ).toBe(true);

    const sessionOnly = fakeResponse();
    setSessionCookies(
      sessionOnly as never,
      { access_token: "a", refresh_token: "r" },
      cfg,
    );
    const sessionMarker = sessionOnly.set.find(
      (cookie) => cookie.name === REMEMBER_ME_COOKIE,
    );
    expect(sessionMarker?.options.maxAge).toBeUndefined();
    expect(
      readRememberMeCookie({ [REMEMBER_ME_COOKIE]: sessionMarker?.value }, cfg),
    ).toBe(false);
  });

  it("sets a root-path routing marker for the refresh-session lifetime", () => {
    const persistent = fakeResponse();
    setSessionCookies(
      persistent as never,
      { access_token: "a", refresh_token: "r" },
      cfg,
      { rememberMe: true },
    );
    const marker = persistent.set.find(
      (cookie) => cookie.name === SESSION_MARKER_COOKIE,
    );
    expect(marker?.options).toMatchObject({
      httpOnly: true,
      path: "/",
      maxAge: cfg.refreshMaxAge * 1000,
    });
    expect(marker?.value).not.toContain("r");

    const sessionOnly = fakeResponse();
    setSessionCookies(
      sessionOnly as never,
      { access_token: "a", refresh_token: "r" },
      cfg,
    );
    expect(
      sessionOnly.set.find((cookie) => cookie.name === SESSION_MARKER_COOKIE)
        ?.options,
    ).not.toHaveProperty("maxAge");
  });

  it("omits domain entirely when blank", () => {
    // `domain: 'localhost'` is rejected by some browsers and the cookie is
    // dropped with no error, so blank must mean absent, not empty-string.
    const res = fakeResponse();
    setSessionCookies(
      res as never,
      { access_token: "a", refresh_token: "r" },
      cfg,
    );
    for (const c of res.set) expect("domain" in c.options).toBe(false);
  });

  it("includes domain when configured", () => {
    const res = fakeResponse();
    setSessionCookies(
      res as never,
      { access_token: "a", refresh_token: "r" },
      {
        ...cfg,
        domain: ".cra.test",
      },
    );
    for (const c of res.set) expect(c.options.domain).toBe(".cra.test");
  });

  it("strips CR/LF from values", () => {
    const res = fakeResponse();
    setSessionCookies(
      res as never,
      { access_token: "a\r\nSet-Cookie: evil=1", refresh_token: "r" },
      cfg,
    );
    expect(res.set[0]?.value).not.toMatch(/[\r\n]/);
  });

  it("clears every cookie on the SAME path it set them", () => {
    // A mismatched path leaves the cookie in place, so "sign out" appears to
    // work and the user is still signed in on the next navigation.
    const res = fakeResponse();
    clearSessionCookies(res as never, cfg);

    const byName = Object.fromEntries(
      res.cleared.map((c) => [c.name, c.options.path]),
    );
    expect(byName[ACCESS_COOKIE]).toBe("/");
    expect(byName[REFRESH_COOKIE]).toBe(REFRESH_COOKIE_PATH);
    expect(byName[REMEMBER_ME_COOKIE]).toBe(REMEMBER_ME_COOKIE_PATH);
    expect(byName[SESSION_MARKER_COOKIE]).toBe("/");
    expect(byName[PENDING_COOKIE]).toBe("/");
    expect(byName[MFA_COOKIE]).toBe("/");
  });
});

describe("sign / unsign", () => {
  const secret = "a-secret-of-sufficient-length";

  it("round-trips a value", () => {
    expect(unsign(sign("org-123", secret), secret)).toBe("org-123");
  });

  it("rejects a tampered value", () => {
    const signed = sign("org-123", secret);
    const tampered = signed.replace("org-123", "org-999");
    expect(unsign(tampered, secret)).toBeNull();
  });

  it("rejects a value signed with a different secret", () => {
    expect(unsign(sign("org-123", "other-secret-value"), secret)).toBeNull();
  });

  it("returns null rather than throwing on malformed input", () => {
    // timingSafeEqual THROWS on a length mismatch, so a truncated cookie would
    // otherwise surface as a 500 on every request until the user cleared it.
    expect(unsign(undefined, secret)).toBeNull();
    expect(unsign("", secret)).toBeNull();
    expect(unsign("no-separator", secret)).toBeNull();
    expect(unsign(".leading", secret)).toBeNull();
    expect(unsign("value.short", secret)).toBeNull();
    expect(unsign("value.zzzz", secret)).toBeNull();
  });

  it("handles a value containing dots", () => {
    // The separator is the LAST dot, so a JWT-shaped value survives.
    expect(unsign(sign("a.b.c", secret), secret)).toBe("a.b.c");
  });
});
