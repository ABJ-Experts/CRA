import { sessionResponseSchema } from "@repo/contracts/auth/schemas";
import { SupabaseSiemRepository } from "../src/audit/siem/infrastructure/supabase-siem.repository";
import { SiemWorker } from "../src/audit/siem/worker/siem-worker";
import type { SiemSendInput } from "../src/audit/siem/application/siem-transport.port";
import { randomBytes, randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  siemDestinationSchema,
  siemDeliveryPageSchema,
  siemDestinationListSchema,
  siemTestResultSchema,
  siemCatalogueSchema,
} from "@repo/contracts/audit/schemas";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../src/app.module";
import { API_PREFIX } from "../src/auth/cookies.util";
import { AllExceptionsFilter } from "../src/common/filters/all-exceptions.filter";
import { NodeSiemTransport } from "../src/audit/siem/infrastructure/node-siem-transport";
import { SiemVault } from "../src/audit/siem/infrastructure/siem-vault";
import { AesGcmConnectorVault } from "../src/connectors/infrastructure/connector-vault";

describe("SIEM authenticated HTTP workflow (local CRA)", () => {
  let app: INestApplication<App>;
  const path = `/${API_PREFIX}/audit/siem`;
  const transport = {
    validate: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockImplementation(async (input: SiemSendInput) => {
      if (!(await input.beforeSend?.()))
        return { outcome: "failed", code: "authorization_revoked" };
      return {
        outcome:
          input.protocol === "syslog_tls" ? "sent_unacknowledged" : "accepted",
        status: input.protocol === "https" ? 202 : null,
        code: null,
        category: null,
        retryable: false,
        retryAfterSeconds: null,
        durationMs: 1,
        responseBytes: 0,
      };
    }),
  };
  beforeAll(async () => {
    const vault = new SiemVault(
      new AesGcmConnectorVault(
        JSON.stringify({
          activeKeyId: "siem-http-test",
          keys: { "siem-http-test": randomBytes(32).toString("base64") },
        }),
      ),
    );
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NodeSiemTransport)
      .useValue(transport)
      .overrideProvider(SiemVault)
      .useValue(vault)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix(API_PREFIX);
    app.use(cookieParser());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  }, 30000);
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
  it("requires verified identity and independent audit permissions", async () => {
    await request(app.getHttpServer())
      .get(`${path}/catalogue`)
      .query({ requestId: randomUUID() })
      .expect(401);
    const viewer = await login("viewer@cra.test");
    await viewer
      .get(`${path}/catalogue`)
      .query({ requestId: randomUUID() })
      .expect(403);
  }, 30000);
  it("parses catalogue and rejects tenant injection", async () => {
    const client = await login();
    siemCatalogueSchema.parse(
      (
        await client
          .get(`${path}/catalogue`)
          .query({ requestId: randomUUID() })
          .expect(200)
      ).body,
    );
    await client
      .post(`${path}/destinations`)
      .send({
        requestId: randomUUID(),
        destinationId: randomUUID(),
        name: "Forbidden tenant injection",
        endpoint: "https://collector.example.test/events",
        transport: "https",
        format: "json",
        eventClasses: ["organization"],
        productIds: [],
        organizationId: randomUUID(),
      })
      .expect(400);
  }, 30000);
  it("creates idempotently, encrypts credentials, tests and enables future-only", async () => {
    const client = await login();
    const input = {
      requestId: randomUUID(),
      destinationId: randomUUID(),
      name: `SIEM HTTP fixture ${randomUUID().slice(0, 8)}`,
      endpoint: "https://collector.example.test/events",
      transport: "https",
      format: "json",
      eventClasses: ["organization"],
      productIds: [],
    };
    const existing = siemDestinationListSchema
      .parse(
        (
          await client
            .get(`${path}/destinations`)
            .query({ requestId: randomUUID() })
            .expect(200)
        ).body,
      )
      .items.find((item) => item.name.startsWith("SIEM HTTP fixture "));
    let destination = existing;
    if (!destination) {
      destination = siemDestinationSchema.parse(
        (await client.post(`${path}/destinations`).send(input).expect(200))
          .body,
      );
      expect(
        siemDestinationSchema.parse(
          (await client.post(`${path}/destinations`).send(input).expect(200))
            .body,
        ).id,
      ).toBe(destination.id);
      await client
        .post(`${path}/destinations`)
        .send({ ...input, name: "Changed input" })
        .expect(409);
    }
    const credentials = {
      requestId: randomUUID(),
      expectedVersion: destination.version,
      credential: { mode: "bearer", token: "SIEM_SECRET_CANARY" },
    };
    destination = siemDestinationSchema.parse(
      (
        await client
          .post(`${path}/destinations/${destination.id}/credentials`)
          .send(credentials)
          .expect(200)
      ).body,
    );
    expect(JSON.stringify(destination)).not.toContain("SIEM_SECRET_CANARY");
    const tested = await client
      .post(`${path}/destinations/${destination.id}/test`)
      .send({ requestId: randomUUID(), expectedVersion: destination.version })
      .expect(200);
    destination = siemTestResultSchema.parse(tested.body).destination;
    destination = siemDestinationSchema.parse(
      (
        await client
          .post(`${path}/destinations/${destination.id}/enable`)
          .send({
            requestId: randomUUID(),
            expectedVersion: destination.version,
          })
          .expect(200)
      ).body,
    );
    expect(destination.state).toBe("enabled");
    const session = sessionResponseSchema.parse(
      (await client.get(`/${API_PREFIX}/auth/session`).expect(200)).body,
    );
    await client
      .post(`/${API_PREFIX}/organizations/switch`)
      .send({ organizationId: session.organization!.id })
      .expect(200);
    const worker = new SiemWorker(
      app.get(SupabaseSiemRepository),
      app.get(NodeSiemTransport),
      app.get(SiemVault),
    );
    for (let batch = 0; batch < 4; batch++) await worker.runOnce();
    const deliveries = await client
      .get(`${path}/destinations/${destination.id}/deliveries`)
      .query({ requestId: randomUUID() })
      .expect(200);
    expect(JSON.stringify(deliveries.body)).not.toContain("SIEM_SECRET_CANARY");
    expect(
      siemDeliveryPageSchema
        .parse(deliveries.body)
        .items.some(
          (item) =>
            item.event.action === "organization.switched" &&
            item.state === "accepted",
        ),
    ).toBe(true);

    siemDestinationListSchema.parse(
      (
        await client
          .get(`${path}/destinations`)
          .query({ requestId: randomUUID() })
          .expect(200)
      ).body,
    );
    await client
      .post(`${path}/destinations/${destination.id}/disable`)
      .send({
        requestId: randomUUID(),
        expectedVersion: destination.version,
        reason: "Owned fixture finished",
      })
      .expect(200);
  }, 30000);
});
