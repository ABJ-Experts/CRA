import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  notificationCriticalRouteResponseSchema,
  notificationDeliveriesResponseSchema,
  notificationPreferencesResponseSchema,
} from "@repo/contracts/notifications";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { App } from "supertest/types";

import { AppModule } from "../src/app.module";
import { API_PREFIX } from "../src/auth/cookies.util";
import { AllExceptionsFilter } from "../src/common/filters/all-exceptions.filter";

/** Local-stack HTTP contract; all requests leave source and settings untouched. */
describe("Notification HTTP boundary (local stack)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix(API_PREFIX);
    app.use(cookieParser());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("denies unauthenticated preference and delivery reads", async () => {
    await request(app.getHttpServer())
      .get(`/${API_PREFIX}/notifications/preferences`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/${API_PREFIX}/notifications/deliveries`)
      .expect(401);
  });

  it("returns parsed self settings, critical route and paginated safe delivery metadata", async () => {
    const session = request.agent(app.getHttpServer());
    await session
      .post(`/${API_PREFIX}/auth/sign-in`)
      .send({
        email: "owner@cra.test",
        password: "Password123",
        remember: false,
      })
      .expect(200);

    const preferences = notificationPreferencesResponseSchema.parse(
      (
        await session
          .get(`/${API_PREFIX}/notifications/preferences`)
          .expect(200)
      ).body,
    ).preferences;
    expect(preferences.modes).toEqual({
      finding_triage: "immediate",
      evidence: "immediate",
      supplier_owner: "immediate",
    });

    const route = notificationCriticalRouteResponseSchema.parse(
      (
        await session
          .get(
            `/${API_PREFIX}/notifications/critical-routes/${preferences.userId}`,
          )
          .expect(200)
      ).body,
    ).route;
    expect(route.userId).toBe(preferences.userId);

    const deliveries = notificationDeliveriesResponseSchema.parse(
      (
        await session
          .get(`/${API_PREFIX}/notifications/deliveries`)
          .query({ limit: 1 })
          .expect(200)
      ).body,
    );
    expect(deliveries.rows.length).toBeLessThanOrEqual(1);

    await session
      .get(`/${API_PREFIX}/notifications/deliveries`)
      .query({ status: "unknown" })
      .expect(400);
  }, 30_000);
});
