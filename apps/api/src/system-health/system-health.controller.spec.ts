import { LicensingGuard } from "../licensing/infrastructure/licensing.guard";
import { Test } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import { ForbiddenException, type INestApplication } from "@nestjs/common";
import { LicensingError } from "../licensing/application/licensing.errors";
import { SupabaseHealthSourceAdapter } from "./infrastructure/supabase-health-source.adapter";
import type { HealthSource } from "./application/system-health.port";
import type { Request, Response, NextFunction } from "express";
import type { Server } from "node:http";
import request from "supertest";
import { SystemHealthController } from "./system-health.controller";
import { SystemHealthUseCases } from "./application/system-health.use-cases";
import { SystemHealthAuthorizationError } from "./application/system-health.port";
import { customerSystemHealthResponseSchema } from "@repo/contracts/system/schemas";
import { REQUIRE_PERMISSIONS_KEY } from "../auth/auth.types";
import { ZodResponseInterceptor } from "../common/http/zod-response.interceptor";
const read = jest.fn();
const org = "00000000-0000-4000-8000-000000000001";
const actor = "00000000-0000-4000-8000-000000000002";
let app: INestApplication;
beforeAll(async () => {
  const module = await Test.createTestingModule({
    controllers: [SystemHealthController],
    providers: [{ provide: SystemHealthUseCases, useValue: { read } }],
  }).compile();
  app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix("api/v1");
  app.useGlobalInterceptors(new ZodResponseInterceptor(new Reflector()));
  app.use(
    (req: Request & { user?: unknown }, _res: Response, next: NextFunction) => {
      req.user = {
        id: actor,
        organizationId: req.headers["x-no-org"] ? null : org,
      };
      next();
    },
  );
  await app.init();
});
afterAll(async () => app.close());
beforeEach(() => read.mockReset());
it("requires explicit health permission", () =>
  expect(
    Reflect.getMetadata(
      REQUIRE_PERMISSIONS_KEY,
      Object.getOwnPropertyDescriptor(SystemHealthController.prototype, "read")
        ?.value as object,
    ),
  ).toEqual(["can_view_system_health"]));
it.each(["organizationId=forged", "productId=forged", "unknown=true"])(
  "rejects forged query %s before application",
  async (query) => {
    await request(app.getHttpServer() as Server)
      .get(`/api/v1/system/health?${query}`)
      .expect(400);
    expect(read).not.toHaveBeenCalled();
  },
);
it("rejects missing verified tenant", async () => {
  await request(app.getHttpServer() as Server)
    .get("/api/v1/system/health")
    .set("x-no-org", "1")
    .expect(403);
  expect(read).not.toHaveBeenCalled();
});
it("fails closed when source authority revoked after guard", async () => {
  read.mockRejectedValueOnce(new SystemHealthAuthorizationError());
  await request(app.getHttpServer() as Server)
    .get("/api/v1/system/health")
    .expect(403);
  expect(read).toHaveBeenCalledWith(org, actor);
});
it("parses outgoing payload and refuses unsafe content", async () => {
  read.mockResolvedValueOnce({ token: "secret" });
  await request(app.getHttpServer() as Server)
    .get("/api/v1/system/health")
    .expect(500);
});
it("propagates unexpected application errors to generic response", async () => {
  read.mockRejectedValueOnce(new Error("private"));
  await request(app.getHttpServer() as Server)
    .get("/api/v1/system/health")
    .expect(500);
});
it("returns a parsed tenant response", async () => {
  const usecase = new SystemHealthUseCases(
    {
      readSource: (_org, _actor, source) =>
        Promise.resolve({
          outcome: "withheld",
          source,
          sourceAt: null,
          observedAt: null,
          data: null,
          reasons: ["source_permission_withheld"],
        }),
    },
    {
      database: () => Promise.resolve(true),
      audit: () => Promise.resolve(true),
      storage: () => Promise.resolve(true),
    },
    null,
  );
  read.mockResolvedValueOnce(await usecase.read(org, actor));
  const response = await request(app.getHttpServer() as Server)
    .get("/api/v1/system/health")
    .expect(200);
  expect(
    customerSystemHealthResponseSchema.parse(response.body as unknown)
      .organizationId,
  ).toBe(org);
});
it("remains a security diagnostic under expired licensing without granting exports", async () => {
  const assertOperation = jest.fn().mockRejectedValue(new Error("expired"));
  const guard = new LicensingGuard({ assertOperation } as never);
  const context = {
    getClass: () => SystemHealthController,
    getHandler: () =>
      Object.getOwnPropertyDescriptor(SystemHealthController.prototype, "read")
        ?.value as object,
  } as never;
  await expect(guard.canActivate(context)).resolves.toBe(true);
  expect(assertOperation).not.toHaveBeenCalled();
});
it.each([
  [
    "identity revoked at final state read",
    new ForbiddenException("identity revoked"),
  ],
  [
    "permission revoked at verification proof",
    new LicensingError("forbidden", 403, "permission revoked"),
  ],
])(
  "denies the complete HTTP snapshot when %s after a ready source check",
  async (_stage, failure) => {
    const sourceChecked = jest.fn();
    const getCurrent = jest.fn().mockImplementation(() => {
      expect(sourceChecked).toHaveBeenCalled();
      return Promise.reject(failure);
    });
    const source = new SupabaseHealthSourceAdapter(
      {
        admin: () => ({
          rpc: (_name: string, args: { p_source: HealthSource }) => ({
            abortSignal: () => {
              sourceChecked();
              return Promise.resolve({
                error: null,
                data: {
                  outcome: args.p_source === "licensing" ? "ready" : "withheld",
                  source: args.p_source,
                  sourceAt: null,
                  observedAt: null,
                  data: args.p_source === "licensing" ? {} : null,
                  reasons:
                    args.p_source === "licensing"
                      ? []
                      : ["source_permission_withheld"],
                },
              });
            },
          }),
        }),
      } as never,
      { getCurrent } as never,
    );
    const usecase = new SystemHealthUseCases(
      source,
      {
        database: () => Promise.resolve(true),
        audit: () => Promise.resolve(true),
        storage: () => Promise.resolve(true),
      },
      null,
    );
    read.mockImplementationOnce((organizationId: string, actorId: string) =>
      usecase.read(organizationId, actorId),
    );
    const response = await request(app.getHttpServer() as Server)
      .get("/api/v1/system/health")
      .expect(403);
    expect(getCurrent).toHaveBeenCalledWith(
      org,
      actor,
      expect.any(AbortSignal),
    );
    expect(response.body as unknown).toMatchObject({ code: "forbidden" });
    expect(JSON.stringify(response.body)).not.toContain("components");
  },
);
it.each([
  new LicensingError("unavailable", 503, "private service unavailable"),
  new LicensingError("forbidden", 503, "not an authorization rejection"),
  new Error("private network failed"),
])(
  "retains independent failure for a licence provider outage %s",
  async (failure) => {
    const source = new SupabaseHealthSourceAdapter(
      {
        admin: () => ({
          rpc: (_name: string, args: { p_source: HealthSource }) => ({
            abortSignal: () =>
              Promise.resolve({
                error: null,
                data: {
                  outcome: args.p_source === "licensing" ? "ready" : "withheld",
                  source: args.p_source,
                  sourceAt: null,
                  observedAt: null,
                  data: args.p_source === "licensing" ? {} : null,
                  reasons:
                    args.p_source === "licensing"
                      ? []
                      : ["source_permission_withheld"],
                },
              }),
          }),
        }),
      } as never,
      { getCurrent: jest.fn().mockRejectedValue(failure) } as never,
    );
    const usecase = new SystemHealthUseCases(
      source,
      {
        database: () => Promise.resolve(true),
        audit: () => Promise.resolve(true),
        storage: () => Promise.resolve(true),
      },
      null,
    );
    read.mockImplementationOnce((organizationId: string, actorId: string) =>
      usecase.read(organizationId, actorId),
    );
    const response = await request(app.getHttpServer() as Server)
      .get("/api/v1/system/health")
      .expect(200);
    const body = customerSystemHealthResponseSchema.parse(
      response.body as unknown,
    );
    expect(
      body.components.find((component) => component.id === "licensing")?.status,
    ).toBe("unreachable");
    expect(body.licence.state).toBeNull();
    expect(JSON.stringify(body)).not.toContain("private");
  },
);
