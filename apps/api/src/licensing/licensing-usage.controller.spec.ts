import type { Server } from "node:http";
import { Test } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";
import { LicensingUsageController } from "./licensing-usage.controller";
import { LICENSING_USAGE_APPLICATION } from "./application/license-usage.service";
import { usageFailure } from "./application/license-usage.errors";
import { LicenseUsageService } from "./application/license-usage.service";
import { ZodResponseInterceptor } from "../common/http/zod-response.interceptor";
import type { RequestUser } from "../auth/auth.types";

const org = "00000000-0000-4000-8000-000000000001";
const actor = "00000000-0000-4000-8000-000000000002";
const input = {
  expectedLicenseVersion: 0,
  expectedMeterVersion: 1,
  idempotencyKey: "00000000-0000-4000-8000-000000000003",
};
const projection = {
  outcome: "ready" as const,
  organizationId: org,
  observedAt: "2026-10-13T00:00:00.000Z",
  licenseVersion: 0,
  policyRevision: null,
  issuanceSequence: null,
  meterVersion: 1,
  reconciledAt: null,
  components: {
    activeMembers: 1,
    reservedInvitations: 0,
    products: 0,
    storageBytes: 0,
    storageReservedBytes: 0,
    protectedStorageBytes: 0,
  },
  availability: {
    seats: "ready" as const,
    products: "ready" as const,
    storage: "ready" as const,
    protected_storage: "ready" as const,
  },
  reasons: { seats: [], products: [], storage: [], protected_storage: [] },
};
describe("LicensingUsageController HTTP boundary", () => {
  let app: INestApplication;
  const application = {
    getUsage: jest.fn(),
    exportUsage: jest.fn(),
    reconcileUsage: jest.fn(),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [LicensingUsageController],
      providers: [
        { provide: LICENSING_USAGE_APPLICATION, useValue: application },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix("api/v1");
    app.useGlobalInterceptors(new ZodResponseInterceptor(new Reflector()));
    app.use(
      (
        req: Request & { user: RequestUser },
        _res: Response,
        next: NextFunction,
      ) => {
        req.user = {
          id: actor,
          organizationId: req.headers["x-test-missing-org"] ? null : org,
        } as RequestUser;
        next();
      },
    );
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    const service = new LicenseUsageService(
      {
        read: jest.fn().mockResolvedValue(projection),
        receipt: jest.fn(),
        export: jest.fn(),
        reconcile: jest.fn(),
      },
      { getCurrent: jest.fn(), instanceConfigured: false, policyRevision: 1 },
    );
    const snapshot = await service.getUsage(org, actor);
    application.getUsage.mockResolvedValue(snapshot);
    application.exportUsage.mockResolvedValue({
      snapshot,
      auditEventId: actor,
      replayed: false,
    });
    application.reconcileUsage.mockResolvedValue({
      auditEventId: actor,
      meterVersion: 2,
      checked: 1,
      repaired: 1,
      released: 0,
      unresolved: 0,
      completedAt: projection.observedAt,
      replayed: false,
    });
  });
  it("resolves the injected application and scopes GET to verified current identity", async () => {
    const response = await request(app.getHttpServer() as Server)
      .get("/api/v1/licensing/usage")
      .expect(200);
    expect(application.getUsage).toHaveBeenCalledWith(org, actor);
    expect(response.body as unknown).toEqual(
      expect.objectContaining({ organizationId: org }),
    );
  });
  it.each(["export", "reconcile"])(
    "returns HTTP200 for %s and forwards only parsed optimistic input",
    async (operation) => {
      await request(app.getHttpServer() as Server)
        .post(`/api/v1/licensing/usage/${operation}`)
        .send(input)
        .expect(200);
      expect(
        operation === "export"
          ? application.exportUsage
          : application.reconcileUsage,
      ).toHaveBeenCalledWith(org, actor, input);
    },
  );
  it.each(["", "/export", "/reconcile"])(
    "rejects an unverified organization on %s",
    async (suffix) => {
      const req = suffix
        ? request(app.getHttpServer() as Server)
            .post(`/api/v1/licensing/usage${suffix}`)
            .send(input)
        : request(app.getHttpServer() as Server).get("/api/v1/licensing/usage");
      await req.set("x-test-missing-org", "1").expect(403);
      expect(application.getUsage).not.toHaveBeenCalled();
      expect(application.exportUsage).not.toHaveBeenCalled();
      expect(application.reconcileUsage).not.toHaveBeenCalled();
    },
  );
  it.each(["", "/export", "/reconcile"])(
    "rejects browser supplied query scope on %s",
    async (suffix) => {
      const req = suffix
        ? request(app.getHttpServer() as Server)
            .post(`/api/v1/licensing/usage${suffix}?organizationId=${actor}`)
            .send(input)
        : request(app.getHttpServer() as Server).get(
            `/api/v1/licensing/usage?organizationId=${actor}`,
          );
      await req.expect(400);
      expect(application.getUsage).not.toHaveBeenCalled();
      expect(application.exportUsage).not.toHaveBeenCalled();
      expect(application.reconcileUsage).not.toHaveBeenCalled();
    },
  );
  it.each([
    { ...input, snapshot: {} },
    { ...input, expectedMeterVersion: -1 },
    { ...input, idempotencyKey: "bad" },
    {},
  ])(
    "rejects invalid mutation input before application logic",
    async (body) => {
      await request(app.getHttpServer() as Server)
        .post("/api/v1/licensing/usage/export")
        .send(body)
        .expect(400);
      expect(application.exportUsage).not.toHaveBeenCalled();
    },
  );

  it("rejects private successful payloads before JSON serialization", async () => {
    application.exportUsage.mockResolvedValueOnce({
      snapshot: {},
      artifact: "private-jws",
      auditEventId: actor,
      replayed: false,
    });
    const response = await request(app.getHttpServer() as Server)
      .post("/api/v1/licensing/usage/export")
      .send(input)
      .expect(500);
    expect(JSON.stringify(response.body)).not.toContain("private-jws");
  });

  it("maps a version race to the safe HTTP error contract", async () => {
    application.exportUsage.mockRejectedValueOnce(usageFailure("conflict"));
    const response = await request(app.getHttpServer() as Server)
      .post("/api/v1/licensing/usage/export")
      .send(input)
      .expect(409);
    expect(response.body).toEqual({
      code: "license_usage_conflict",
      message: "Licence or usage changed; reload and try again",
    });
  });
});
