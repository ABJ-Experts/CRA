import type { INestApplication } from "@nestjs/common";
import { MODULE_METADATA } from "@nestjs/common/constants";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import request from "supertest";
import type { App } from "supertest/types";

import { AppModule } from "../../app.module";
import { PermissionsGuard } from "../../auth/permissions.guard";
import { AuthModule } from "../../auth/auth.module";
import { SupabaseAuthGuard } from "../../auth/supabase-auth.guard";
import { PermissionsModule } from "../../permissions/permissions.module";
import { SupabaseModule } from "../../supabase/supabase.module";
import { SECURITY_GUARD_ORDER, SecurityModule } from "./security.module";

describe("SecurityModule", () => {
  it("pins the global guard chain", () => {
    expect(SECURITY_GUARD_ORDER).toEqual([
      ThrottlerGuard.name,
      SupabaseAuthGuard.name,
      PermissionsGuard.name,
    ]);
  });

  it("registers each guard once and in security order", () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      SecurityModule,
    ) as readonly Readonly<{ provide: unknown; useClass: unknown }>[];

    expect(providers).toEqual([
      { provide: APP_GUARD, useClass: ThrottlerGuard },
      { provide: APP_GUARD, useClass: SupabaseAuthGuard },
      { provide: APP_GUARD, useClass: PermissionsGuard },
    ]);
  });

  it("imports every module needed by the centralized guards", () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, SecurityModule),
    ).toEqual([AuthModule, PermissionsModule, SupabaseModule]);
  });

  it("runs rate limiting before authentication and authorization per request", async () => {
    const calls: string[] = [];
    const throttle = jest
      .spyOn(ThrottlerGuard.prototype, "canActivate")
      .mockImplementation(() => {
        calls.push("throttle");
        return Promise.resolve(true);
      });
    const authenticate = jest
      .spyOn(SupabaseAuthGuard.prototype, "canActivate")
      .mockImplementation((context) => {
        calls.push("authenticate");
        context.switchToHttp().getRequest<{ user?: unknown }>().user = {
          id: "request-user",
        };
        return Promise.resolve(true);
      });
    const authorize = jest
      .spyOn(PermissionsGuard.prototype, "canActivate")
      .mockImplementation((context) => {
        expect(
          context.switchToHttp().getRequest<{ user?: unknown }>().user,
        ).toBeDefined();
        calls.push("authorize");
        return Promise.resolve(false);
      });

    let app: INestApplication<App> | undefined;
    try {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleRef.createNestApplication();
      await app.init();

      await request(app.getHttpServer()).get("/auth/session").expect(403);
      expect(calls).toEqual(["throttle", "authenticate", "authorize"]);
    } finally {
      await app?.close();
      throttle.mockRestore();
      authenticate.mockRestore();
      authorize.mockRestore();
    }
  });
});
