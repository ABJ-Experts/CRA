import {
  BackupScopeError,
  BackupAuthorizationError,
  BackupUnavailableError,
} from "./domain/backup-errors";
import { Test } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { ZodResponseInterceptor } from "../common/http/zod-response.interceptor";
import { BackupUseCases } from "./application/backup-use-cases";
import { OperatorBackupsController } from "./operator-backups.controller";
import { CustomerBackupsController } from "./customer-backups.controller";
import { BackupAssuranceUseCases } from "./application/backup-assurance.use-cases";
import request from "supertest";
import type { Server } from "node:http";
import type { Request, Response, NextFunction } from "express";
const instanceId = "20000000-0000-4000-8000-000000000001";
const runId = "30000000-0000-4000-8000-000000000001";
const configuration = {
  sourceAlias: "source",
  repositoryAlias: "repository",
  stagingAlias: "staging",
  keyAlias: "key",
  targetProfile: "isolated",
  residency: "local",
  schedulingEnabled: false,
  checkpointIntervalMinutes: 30,
  baseIntervalHours: 24,
  verificationIntervalDays: 30,
  retentionDays: 30,
  pauseLimitSeconds: 120,
};
const mutation = {
  expectedVersion: 1,
  idempotencyKey: "40000000-0000-4000-8000-000000000001",
};
const run = {
  id: runId,
  instanceId,
  kind: "capture",
  parentRunId: null,
  state: "queued",
  stage: "queued",
  progress: 0,
  version: 1,
  attempt: 0,
  configurationRevision: 1,
  createdAt: "2026-10-14T00:00:00.000Z",
  startedAt: null,
  completedAt: null,
  durationMs: null,
  failureCode: null,
  certificate: null,
  verification: null,
  cleanup: { state: "retained", deletedAt: null },
};
let app: INestApplication;
const execute = jest.fn();
const summary = jest.fn();
const history = jest.fn();
const detail = jest.fn();
beforeAll(async () => {
  const module = await Test.createTestingModule({
    controllers: [OperatorBackupsController, CustomerBackupsController],
    providers: [
      { provide: BackupUseCases, useValue: { execute } },
      {
        provide: BackupAssuranceUseCases,
        useValue: { summary, history, detail },
      },
    ],
  }).compile();
  app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix("api/v1");
  app.useGlobalInterceptors(new ZodResponseInterceptor(new Reflector()));
  app.use(
    (
      req: Request & { operatorIdentity?: unknown; user?: unknown },
      _res: Response,
      next: NextFunction,
    ) => {
      req.operatorIdentity = { principalId: "operator" };
      req.user = {
        id: "actor",
        organizationId: req.headers["x-no-org"] ? null : "org",
      };
      next();
    },
  );
  await app.init();
});
afterAll(async () => app.close());
beforeEach(() => jest.clearAllMocks());
it("parses every operator input and successful output", async () => {
  const base = `/api/v1/operator/instances/${instanceId}/backups`;
  execute.mockResolvedValueOnce(null);
  await request(app.getHttpServer() as Server)
    .get(`${base}/policy`)
    .expect(200, { policy: null });
  execute.mockResolvedValueOnce({
    valid: false,
    checkedAt: run.createdAt,
    configurationDigest: "a".repeat(64),
    checks: [{ code: "runtime_compatibility", status: "unavailable" }],
  });
  await request(app.getHttpServer() as Server)
    .post(`${base}/policy/validate`)
    .send({ configuration })
    .expect(201);
  execute.mockResolvedValueOnce({
    instanceId,
    version: 1,
    configurationRevision: 1,
    configuration,
    approvedAt: run.createdAt,
    approvedBy: "operator",
    lastValidatedAt: null,
  });
  await request(app.getHttpServer() as Server)
    .put(`${base}/policy`)
    .send({ ...mutation, configuration })
    .expect(200);
  for (const [suffix, body] of [
    ["runs", mutation],
    [`runs/${runId}/cancel`, mutation],
    [`runs/${runId}/verifications`, { ...mutation, targetProfile: "isolated" }],
    [
      `runs/${runId}/cleanup`,
      { ...mutation, reviewFingerprint: "a".repeat(64) },
    ],
  ] as const) {
    execute.mockResolvedValueOnce(run);
    await request(app.getHttpServer() as Server)
      .post(`${base}/${suffix}`)
      .send(body)
      .expect(201);
  }
  execute.mockResolvedValueOnce({
    runId,
    version: 1,
    eligible: false,
    reviewFingerprint: "a".repeat(64),
    reviewedAt: run.createdAt,
    blockers: ["retention_active"],
  });
  await request(app.getHttpServer() as Server)
    .post(`${base}/runs/${runId}/cleanup-review`)
    .send({ expectedVersion: 1 })
    .expect(201);
  execute.mockResolvedValueOnce({ items: [run], nextCursor: null });
  await request(app.getHttpServer() as Server)
    .get(`${base}/runs?limit=25`)
    .expect(200);
  execute.mockResolvedValueOnce(run);
  await request(app.getHttpServer() as Server)
    .get(`${base}/runs/${runId}`)
    .expect(200);
  const calls = execute.mock.calls.length;
  for (const [path, body] of [
    [`${base}/runs`, { ...mutation, path: "../../etc" }],
    [`/api/v1/operator/instances/forged/backups/runs`, mutation],
  ])
    await request(app.getHttpServer() as Server)
      .post(path as string)
      .send(body)
      .expect(400);
  expect(execute.mock.calls).toHaveLength(calls);
  execute.mockResolvedValueOnce({ password: "canary" });
  await request(app.getHttpServer() as Server)
    .get(`${base}/policy`)
    .expect(500);
});
it("keeps customer reads scoped and strips global internals by response rejection", async () => {
  const assurance = {
    status: "unavailable",
    lastAttempt: null,
    lastCapture: null,
    lastVerification: null,
    lastVerifiedRestoreAt: null,
    recoverablePointAt: null,
    verificationDueAt: null,
    residency: null,
    sourceAt: null,
    observedAt: run.createdAt,
    reasons: ["not_configured"],
  };
  summary.mockResolvedValueOnce(assurance);
  await request(app.getHttpServer() as Server)
    .get("/api/v1/system/backups")
    .expect(200);
  expect(summary).toHaveBeenCalledWith("org", "actor");
  history.mockResolvedValueOnce({ items: [], nextCursor: null });
  await request(app.getHttpServer() as Server)
    .get("/api/v1/system/backups/runs?limit=4")
    .expect(200);
  expect(history).toHaveBeenCalledWith("org", "actor", 4, undefined, undefined);
  await request(app.getHttpServer() as Server)
    .get("/api/v1/system/backups")
    .set("x-no-org", "1")
    .expect(403);
  await request(app.getHttpServer() as Server)
    .get("/api/v1/system/backups?organizationId=forged")
    .expect(400);
});
it("maps pure authorization and unavailable failures to closed HTTP statuses", async () => {
  const operatorPath = `/api/v1/operator/instances/${instanceId}/backups/policy`;
  execute.mockRejectedValueOnce(new BackupScopeError());
  await request(app.getHttpServer() as Server)
    .get(operatorPath)
    .expect(404);
  execute.mockRejectedValueOnce(new Error("synthetic canary"));
  await request(app.getHttpServer() as Server)
    .get(operatorPath)
    .expect(500);
  summary.mockRejectedValueOnce(new BackupAuthorizationError());
  await request(app.getHttpServer() as Server)
    .get("/api/v1/system/backups")
    .expect(403);
  summary.mockRejectedValueOnce(new BackupUnavailableError());
  await request(app.getHttpServer() as Server)
    .get("/api/v1/system/backups")
    .expect(503);
  summary.mockRejectedValueOnce(new Error("synthetic canary"));
  await request(app.getHttpServer() as Server)
    .get("/api/v1/system/backups")
    .expect(500);
});

it("constructs Nest controllers with real application policy providers and preserves denied scopes", async () => {
  const control = { execute: jest.fn().mockResolvedValue(null) };
  const repository = {
    read: jest.fn().mockResolvedValue({ outcome: "forbidden" }),
  };
  const module = await Test.createTestingModule({
    controllers: [OperatorBackupsController, CustomerBackupsController],
    providers: [
      {
        provide: BackupUseCases,
        useFactory: () => new BackupUseCases(instanceId, control),
      },
      {
        provide: BackupAssuranceUseCases,
        useFactory: () => new BackupAssuranceUseCases(repository),
      },
    ],
  }).compile();
  const actual = module.createNestApplication({ logger: false });
  actual.useGlobalInterceptors(new ZodResponseInterceptor(new Reflector()));
  actual.use(
    (
      req: Request & { operatorIdentity?: unknown; user?: unknown },
      _res: Response,
      next: NextFunction,
    ) => {
      req.operatorIdentity = {
        principalId: "40000000-0000-4000-8000-000000000001",
        instanceIds: [instanceId],
        backupScopes: req.headers["x-no-backup-grant"]
          ? []
          : [{ instanceId, actions: ["backups.view"] }],
      };
      req.user = { id: "actor", organizationId: "org" };
      next();
    },
  );
  await actual.init();
  try {
    await request(actual.getHttpServer() as Server)
      .get(`/operator/instances/${instanceId}/backups/policy`)
      .expect(200, { policy: null });
    expect(control.execute).toHaveBeenCalledWith(
      instanceId,
      "40000000-0000-4000-8000-000000000001",
      "policy/read",
      {},
    );
    control.execute.mockClear();
    await request(actual.getHttpServer() as Server)
      .get(`/operator/instances/${instanceId}/backups/policy`)
      .set("x-no-backup-grant", "1")
      .expect(404);
    expect(control.execute).not.toHaveBeenCalled();
    await request(actual.getHttpServer() as Server)
      .get("/system/backups/runs")
      .expect(403);
    expect(repository.read).toHaveBeenCalledWith(
      "org",
      "actor",
      25,
      undefined,
      undefined,
    );
  } finally {
    await actual.close();
  }
});
