import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { App } from "supertest/types";

import { AppModule } from "./../src/app.module";
import { API_PREFIX } from "./../src/auth/cookies.util";
import {
  AllExceptionsFilter,
  type ApiErrorBody,
} from "./../src/common/filters/all-exceptions.filter";

/**
 * Replaces the generated spec, which asserted `GET /` returns "Hello World!".
 *
 * That route no longer exists: `setGlobalPrefix('api/v1')` moved everything, and
 * the starter AppController was removed because it would 401 the moment the
 * global auth guard lands. Health is now the guaranteed-open target the suite
 * asserts against.
 *
 * Requires a running local Supabase (`pnpm --filter infrastructure run db:start`)
 * because AppModule validates its environment at boot.
 */
describe("App (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(API_PREFIX);
    app.use(cookieParser());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves health under the /api/v1 prefix", async () => {
    const res = await request(app.getHttpServer())
      .get(`/${API_PREFIX}/health`)
      .expect(200);
    expect(res.body).toMatchObject({ status: "ok" });
  });

  it("reports the database as reachable", async () => {
    const res = await request(app.getHttpServer())
      .get(`/${API_PREFIX}/health/ready`)
      .expect(200);
    expect(res.body).toEqual({ status: "ok", database: true });
  });

  it("serves nothing outside the prefix", async () => {
    // Guards against someone quietly dropping setGlobalPrefix: the refresh
    // cookie's path is derived from it, so an unprefixed API means the browser
    // stops sending the refresh token and sessions die after one hour.
    await request(app.getHttpServer()).get("/health").expect(404);
    await request(app.getHttpServer()).get("/").expect(404);
  });

  it("shapes errors as the frozen auth screens expect", async () => {
    const res = await request(app.getHttpServer())
      .get(`/${API_PREFIX}/does-not-exist`)
      .expect(404);

    // { statusCode, message } — the same shape as AuthResult, so
    // auth-actions.ts needs no mapping layer.
    const body = res.body as ApiErrorBody;
    expect(body).toHaveProperty("statusCode", 404);
    expect(typeof body.message).toBe("string");
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("hasError");
  });
});
