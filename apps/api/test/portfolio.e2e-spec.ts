import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  portfolioConcentrationResponseSchema,
  portfolioDetailResponseSchema,
  portfolioProductsResponseSchema,
} from "@repo/contracts/dashboard/schemas";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../src/app.module";
import { API_PREFIX } from "../src/auth/cookies.util";
import { AllExceptionsFilter } from "../src/common/filters/all-exceptions.filter";

/** Real HTTP/security boundary. Read-only apart from normal seeded-user login.
 * Run serially with other suites sharing seeded sessions (zero epoch skew). */
describe("Portfolio HTTP boundary (local stack)", () => {
  let app: INestApplication<App>;
  const path = `/${API_PREFIX}/dashboard/portfolio`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix(API_PREFIX);
    app.use(cookieParser());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  async function login(email = "owner@cra.test") {
    const client = request.agent(app.getHttpServer());
    await client
      .post(`/${API_PREFIX}/auth/sign-in`)
      .send({ email, password: "Password123", remember: false })
      .expect(200);
    return client;
  }

  it("denies anonymous access on every endpoint", async () => {
    for (const endpoint of [
      "products",
      "concentration",
      "concentration/detail",
    ])
      await request(app.getHttpServer()).get(`${path}/${endpoint}`).expect(401);
  });

  it("rejects forged tenant fields, unbounded pages and malformed references", async () => {
    const client = await login();
    for (const endpoint of ["products", "concentration"])
      for (const query of [
        { organizationId: randomUUID() },
        { limit: "101" },
        { limit: "0" },
        { includeArchived: "yes" },
        { productId: "invalid" },
        { cursor: "forged" },
      ])
        await client.get(`${path}/${endpoint}`).query(query).expect(400);
    await client.get(`${path}/concentration/detail`).expect(400);
    await client
      .get(`${path}/concentration/detail`)
      .query({ componentRef: "forged" })
      .expect(400);
  }, 30_000);

  it("conceals foreign entity/product identifiers before aggregation", async () => {
    const client = await login();
    for (const endpoint of ["products", "concentration"])
      for (const query of [
        { productId: randomUUID() },
        { legalEntityId: randomUUID() },
      ])
        await client.get(`${path}/${endpoint}`).query(query).expect(404);
  }, 30_000);

  it("returns parsed source-owned rows, bounded drilldown and deterministic first pages", async () => {
    const client = await login();
    const products = portfolioProductsResponseSchema.parse(
      (await client.get(`${path}/products`).query({ limit: 2 }).expect(200))
        .body,
    );
    expect(products.scope.includeArchived).toBe(false);
    if (products.products.state === "available")
      expect(products.products.data.rows.length).toBeLessThanOrEqual(2);
    const concentration = portfolioConcentrationResponseSchema.parse(
      (
        await client
          .get(`${path}/concentration`)
          .query({ limit: 2 })
          .expect(200)
      ).body,
    );
    expect(concentration.organizationId).toBe(products.organizationId);
    if (concentration.concentration.state !== "available") return;
    const rows = concentration.concentration.data.rows;
    expect(rows.length).toBeLessThanOrEqual(2);
    const again = portfolioConcentrationResponseSchema.parse(
      (
        await client
          .get(`${path}/concentration`)
          .query({ limit: 2 })
          .expect(200)
      ).body,
    );
    if (again.concentration.state === "available")
      expect(
        again.concentration.data.rows.map(({ packageIdentity, version }) => [
          packageIdentity,
          version,
        ]),
      ).toEqual(
        rows.map(({ packageIdentity, version }) => [packageIdentity, version]),
      );
    for (const row of rows) {
      expect(row.productCount).toBeGreaterThanOrEqual(2);
      const detail = portfolioDetailResponseSchema.parse(
        (
          await client
            .get(`${path}/concentration/detail`)
            .query({ componentRef: row.componentRef, limit: 2 })
            .expect(200)
        ).body,
      );
      expect(detail.component.packageIdentity).toBe(row.packageIdentity);
      expect(detail.component.version).toBe(row.version);
      const otherSession = await login("viewer@cra.test");
      await otherSession
        .get(`${path}/concentration/detail`)
        .query({ componentRef: row.componentRef, limit: 2 })
        .expect(400);
      if (detail.affectedReleases.state === "available")
        expect(detail.affectedReleases.data.rows.length).toBeLessThanOrEqual(2);
      await client
        .get(`${path}/concentration/detail`)
        .query({ componentRef: row.componentRef, includeArchived: true })
        .expect(400);
    }
  }, 60_000);

  it("withholds readiness values for the seeded viewer", async () => {
    const client = await login("viewer@cra.test");
    const result = portfolioProductsResponseSchema.parse(
      (await client.get(`${path}/products`).expect(200)).body,
    );
    if (result.products.state === "available")
      for (const product of result.products.data.rows) {
        expect(product.readiness.state).toBe("restricted");
        expect(product.readiness).not.toHaveProperty("data");
      }
  }, 30_000);
});
