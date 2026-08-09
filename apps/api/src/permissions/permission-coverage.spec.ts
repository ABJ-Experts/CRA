import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { MetadataScanner, ModulesContainer, Reflector } from "@nestjs/core";
import { isPermissionKey } from "@repo/contracts/permissions";

import { AppModule } from "../app.module";
import {
  IS_PUBLIC_KEY,
  REQUIRE_PERMISSIONS_KEY,
  REQUIRE_ROLE_KEY,
  SELF_SCOPED_KEY,
} from "../auth/auth.types";

/**
 * PERMISSION COVERAGE.
 *
 * Authentication is handled by a deny-by-default global guard, so no route can
 * be accidentally anonymous. AUTHORIZATION has no such default: a route with no
 * `@RequirePermissions` is reachable by any authenticated member of the
 * organization, whatever their role.
 *
 * That is legitimate for routes that only touch the caller's own data, and it
 * is a hole for anything else. So every authenticated route must declare one
 * of three things:
 *
 *   @RequirePermissions(...)  — needs specific permissions
 *   @RequireRole(...)         — needs a minimum base role
 *   @SelfScoped("reason")     — only ever touches the caller's own data
 *
 * Like the public-route spec, this fails in BOTH directions, so the exemption
 * list cannot rot: a `@SelfScoped` route that later starts reading other
 * people's data will still pass — which is why the decorator demands a written
 * reason that a reviewer has to read and agree with.
 */

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

interface RouteInfo {
  key: string;
  isPublic: boolean;
  permissions: string[] | undefined;
  role: string | undefined;
  selfScoped: string | undefined;
}

function collect(app: INestApplication): RouteInfo[] {
  const modules = app.get(ModulesContainer);
  const reflector = app.get(Reflector);
  const scanner = new MetadataScanner();
  const routes: RouteInfo[] = [];

  for (const module of modules.values()) {
    for (const wrapper of module.controllers.values()) {
      const instance = wrapper.instance as object | undefined;
      const controllerClass = wrapper.metatype as
        (new (...a: never[]) => unknown) | undefined;
      if (!instance || !controllerClass) continue;

      const controllerPath =
        (Reflect.getMetadata(PATH_METADATA, controllerClass) as string) ?? "";
      const prototype = Object.getPrototypeOf(instance) as object;

      for (const name of scanner.getAllMethodNames(prototype)) {
        const handler = (prototype as Record<string, unknown>)[name];
        if (typeof handler !== "function") continue;

        const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as
          string | undefined;
        if (methodPath === undefined) continue;

        const verb = Reflect.getMetadata(METHOD_METADATA, handler) as
          number | undefined;
        const targets = [handler as never, controllerClass as never];

        routes.push({
          key: `${VERBS[verb ?? 0] ?? "GET"} ${[controllerPath, methodPath]
            .map((p) => p.replace(/^\/|\/$/g, ""))
            .filter(Boolean)
            .join("/")}`,
          isPublic:
            reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ===
            true,
          permissions: reflector.getAllAndOverride<string[]>(
            REQUIRE_PERMISSIONS_KEY,
            targets,
          ),
          role: reflector.getAllAndOverride<string>(REQUIRE_ROLE_KEY, targets),
          selfScoped: reflector.getAllAndOverride<string>(
            SELF_SCOPED_KEY,
            targets,
          ),
        });
      }
    }
  }

  return routes;
}

describe("permission coverage", () => {
  let app: INestApplication;
  let routes: RouteInfo[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    routes = collect(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("finds routes (guards the test itself)", () => {
    expect(routes.length).toBeGreaterThan(10);
  });

  it("every authenticated route declares a permission, a role, or a reasoned exemption", () => {
    const undeclared = routes
      .filter((r) => !r.isPublic)
      .filter((r) => !r.permissions?.length && !r.role && !r.selfScoped)
      .map((r) => r.key);

    // Auth routes act on the caller's own session by definition.
    const AUTH_SELF = [
      "POST auth/sign-out",
      "POST auth/unlock",
      "GET auth/session",
    ];
    expect(undeclared.filter((k) => !AUTH_SELF.includes(k))).toEqual([]);
  });

  it("every declared permission key actually exists", () => {
    // A typo'd key is worse than a missing decorator: the check can never pass,
    // so the route is permanently 403 for everyone including an owner.
    const bogus = routes
      .flatMap((r) => r.permissions ?? [])
      .filter((k) => !isPermissionKey(k));

    expect(bogus).toEqual([]);
  });

  it("no public route also demands a permission", () => {
    // A contradiction: the guard has no user to check against.
    const contradictory = routes
      .filter((r) => r.isPublic && (r.permissions?.length || r.role))
      .map((r) => r.key);

    expect(contradictory).toEqual([]);
  });

  it("every self-scoped exemption carries a non-trivial reason", () => {
    for (const route of routes.filter((r) => r.selfScoped)) {
      expect(route.selfScoped!.length).toBeGreaterThan(15);
    }
  });
});
