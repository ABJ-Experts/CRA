import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { MetadataScanner, ModulesContainer, Reflector } from "@nestjs/core";

import { AppModule } from "../app.module";
import { IS_PUBLIC_KEY } from "./auth.types";

/**
 * ROUTE-GUARD COVERAGE.
 *
 * The global `SupabaseAuthGuard` denies by default, so every route is protected
 * unless it carries `@Public()`. That is the right default, but it makes the
 * `@Public()` decorator the entire attack surface — and a decorator added in a
 * hurry is invisible in review.
 *
 * So this spec enumerates every route from Nest's own metadata and asserts the
 * public set matches a hand-written allowlist EXACTLY. It fails in BOTH
 * directions:
 *
 *   - a new `@Public()` route that nobody listed  -> fail (accidental exposure)
 *   - an allowlist entry with no matching route   -> fail (rotting allowlist)
 *
 * The second direction matters as much as the first. An allowlist that is only
 * checked one way accumulates stale entries, and stale entries are how a route
 * that was once public silently stays public after being repurposed.
 *
 * Adding a route here should require a sentence explaining why it must be
 * reachable without a session.
 */

/** Every route that is intentionally reachable without authentication. */
const ALLOWED_PUBLIC: Record<string, string> = {
  "GET health": "Liveness probe. Must answer before anything is configured.",
  "GET health/ready":
    "Readiness probe for orchestration; reports database reachability only.",

  "POST auth/sign-up": "Creating an account cannot require an account.",
  "POST auth/sign-in": "Ditto.",
  "GET auth/refresh":
    "The access token is expired by definition; the refresh cookie is the credential. It is path-scoped so the browser only sends it here.",
  "POST auth/refresh": "XHR counterpart of the above.",
  "POST auth/verify-email":
    "Identity comes from the signed cra_pending cookie, not a session — the frozen verifyCode({code}) carries no identity.",
  "POST auth/resend-code":
    "Same pending-cookie identity; resendCode() takes no arguments at all.",
  "POST auth/forgot-password":
    "By definition the caller cannot sign in. Always returns ok to avoid account enumeration.",
  "POST auth/reset-password": "The emailed single-use token is the credential.",
  "POST ci/sbom-uploads":
    "CI cannot have a browser session; the dedicated SBOM CI credential guard authenticates this narrow intake route.",
  "POST ci/sbom-uploads/:sourceId/complete":
    "Continuation of the CI direct-upload protocol, guarded by the same organization-scoped credential.",
};

interface RouteInfo {
  method: string;
  path: string;
  isPublic: boolean;
}

function collectRoutes(app: INestApplication): RouteInfo[] {
  const modules = app.get(ModulesContainer);
  const reflector = app.get(Reflector);
  const scanner = new MetadataScanner();
  const routes: RouteInfo[] = [];

  for (const module of modules.values()) {
    for (const wrapper of module.controllers.values()) {
      const instance = wrapper.instance as object | undefined;
      if (!instance) continue;

      const controllerClass = wrapper.metatype as
        (new (...a: never[]) => unknown) | undefined;
      if (!controllerClass) continue;

      const controllerPath =
        (Reflect.getMetadata(PATH_METADATA, controllerClass) as string) ?? "";
      const prototype = Object.getPrototypeOf(instance) as object;

      for (const methodName of scanner.getAllMethodNames(prototype)) {
        const handler = (prototype as Record<string, unknown>)[methodName];
        if (typeof handler !== "function") continue;

        const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as
          string | undefined;
        if (methodPath === undefined) continue;

        const verb = Reflect.getMetadata(METHOD_METADATA, handler) as
          number | undefined;

        const isPublic =
          reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            handler as never,
            controllerClass as never,
          ]) === true;

        const path = [controllerPath, methodPath]
          .map((p) => p.replace(/^\/|\/$/g, ""))
          .filter(Boolean)
          .join("/");

        routes.push({ method: VERBS[verb ?? 0] ?? "GET", path, isPublic });
      }
    }
  }

  return routes;
}

// Mirrors @nestjs/common's RequestMethod enum ordering.
const VERBS = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "ALL",
  "OPTIONS",
  "HEAD",
];

describe("route guard coverage", () => {
  let app: INestApplication;
  let routes: RouteInfo[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    routes = collectRoutes(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("discovers routes at all (guards the test itself)", () => {
    // Without this, a change to Nest's metadata layout would make every
    // assertion below pass vacuously against an empty list.
    expect(routes.length).toBeGreaterThan(5);
  });

  it("exposes no public route that is not on the allowlist", () => {
    const unexpected = routes
      .filter((r) => r.isPublic)
      .map((r) => `${r.method} ${r.path}`)
      .filter((key) => !(key in ALLOWED_PUBLIC));

    expect(unexpected).toEqual([]);
  });

  it("has no stale allowlist entries", () => {
    const actual = new Set(
      routes.filter((r) => r.isPublic).map((r) => `${r.method} ${r.path}`),
    );
    const stale = Object.keys(ALLOWED_PUBLIC).filter((key) => !actual.has(key));

    expect(stale).toEqual([]);
  });

  it("protects every route that is not explicitly public", () => {
    const unprotected = routes
      .filter((r) => !r.isPublic)
      .map((r) => `${r.method} ${r.path}`);

    // Not an assertion that the list is empty — it is a record of what IS
    // protected, so a route silently flipping to public shows up in the diff of
    // the two assertions above.
    expect(unprotected.every((key) => !(key in ALLOWED_PUBLIC))).toBe(true);
  });

  it("keeps the session endpoint authenticated", () => {
    const session = routes.find((r) => r.path === "auth/session");
    expect(session).toBeDefined();
    expect(session?.isPublic).toBe(false);
  });

  it("keeps sign-out authenticated", () => {
    const signOut = routes.find((r) => r.path === "auth/sign-out");
    expect(signOut?.isPublic).toBe(false);
  });
});
