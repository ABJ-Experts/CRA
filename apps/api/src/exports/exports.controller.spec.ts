import { PassThrough, Readable } from "node:stream";
import type { Request, Response } from "express";
import { createExportJobSchema } from "@repo/contracts/exports";
import {
  ExportsController,
  ProductReadinessExportsController,
} from "./exports.controller";
import {
  ExportAccessDeniedError,
  ExportConflictError,
  ExportInvalidRequestError,
  ExportUnavailableError,
} from "./domain/export.errors";
import type { ExportsUseCases } from "./application/exports.use-cases";
import type { ConfigService } from "@nestjs/config";
import type { RequestUser } from "../auth/auth.types";
const user = {} as RequestUser;
describe("ExportsController", () => {
  const get = jest.fn();
  const controller = new ExportsController(
    { get } as unknown as ExportsUseCases,
    { get: () => false } as unknown as ConfigService,
  );
  it.each([
    [ExportAccessDeniedError, 404],
    [ExportConflictError, 409],
    [ExportInvalidRequestError, 400],
    [ExportUnavailableError, 503],
  ] as const)("maps %p without internal details", async (ErrorType, status) => {
    get.mockRejectedValue(new ErrorType());
    await expect(controller.get(user, { jobId: "id" })).rejects.toMatchObject({
      status,
    });
  });
  it("wraps parsed job data", async () => {
    get.mockResolvedValue({ id: "id" });
    await expect(controller.get(user, { jobId: "id" })).resolves.toEqual({
      data: { id: "id" },
    });
  });
});

describe("export HTTP boundaries", () => {
  const methods = {
    manifest: jest.fn(),
    create: jest.fn(),
    list: jest.fn(),
    get: jest.fn(),
    mutate: jest.fn(),
    grant: jest.fn(),
    download: jest.fn(),
    createReadiness: jest.fn(),
  };
  const config = {
    get: (key: string) =>
      key === "COOKIE_SECURE"
        ? true
        : key === "COOKIE_DOMAIN"
          ? "example.test"
          : undefined,
  } as unknown as ConfigService;
  const controller = new ExportsController(
    methods as unknown as ExportsUseCases,
    config,
  );
  const jobId = "99514f0e-2ce0-456c-92d7-f0229dfd6e47";
  beforeEach(() => jest.clearAllMocks());
  it("delivers only freshly authorized manifest data", async () => {
    methods.manifest.mockResolvedValue({ version: "m14_03_v1" });
    expect(await controller.manifest(user, { jobId })).toEqual({
      data: { version: "m14_03_v1" },
    });
    expect(methods.manifest).toHaveBeenCalledWith(user, jobId);
  });
  it("queues input and keeps source checks in application", async () => {
    const input = createExportJobSchema.parse({
      source: "products.registry",
      context: {},
      filters: {},
      format: "csv",
      idempotencyKey: jobId,
    });
    methods.create.mockResolvedValue({ id: jobId });
    expect(await controller.create(user, input)).toEqual({
      data: { id: jobId },
    });
    expect(methods.create).toHaveBeenCalledWith(user, input);
  });
  it("passes parsed list query", async () => {
    methods.list.mockResolvedValue({ data: [], nextCursor: null });
    expect(await controller.list(user, { limit: 25 })).toEqual({
      data: [],
      nextCursor: null,
    });
  });
  it.each(["cancel", "retry"] as const)(
    "preserves version and idempotency for %s",
    async (method) => {
      methods.mutate.mockResolvedValue({ id: jobId });
      expect(
        await controller[method](
          user,
          { jobId },
          { expectedVersion: 2, idempotencyKey: jobId },
        ),
      ).toEqual({ data: { id: jobId } });
      expect(methods.mutate).toHaveBeenCalledWith(
        user,
        jobId,
        2,
        jobId,
        method,
      );
    },
  );
  it("sets a five-minute strict HttpOnly grant cookie at only this delivery path", async () => {
    const grant = {
      grantId: jobId,
      expiresAt: "2026-10-09T00:05:00Z",
      downloadPath: `/api/v1/exports/${jobId}/download/${jobId}`,
    };
    methods.grant.mockResolvedValue({ grant, cookieValue: "opaque" });
    const response = { cookie: jest.fn() };
    expect(
      await controller.grant(
        user,
        { jobId },
        { artifactId: jobId },
        response as unknown as Response,
      ),
    ).toEqual({ data: grant });
    expect(response.cookie).toHaveBeenCalledWith("cra_list_export", "opaque", {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      domain: "example.test",
      path: grant.downloadPath,
      maxAge: 300000,
    });
  });
  it("passes unknown errors unchanged", async () => {
    const error = new Error("unclassified");
    methods.get.mockRejectedValue(error);
    await expect(controller.get(user, { jobId })).rejects.toBe(error);
  });
  it("streams only verified artifacts and always cleans up", async () => {
    const response = new PassThrough() as unknown as Response;
    const setHeader = jest.fn();
    response.setHeader = setHeader;
    response.clearCookie = jest.fn();
    const cleanup = jest.fn().mockResolvedValue(undefined);
    methods.download.mockResolvedValue({
      body: Readable.from(["approved"]),
      byteLength: 8,
      sha256: "a".repeat(64),
      mediaType: "text/csv",
      name: "part.csv",
      cleanup,
    });
    const bytes: Buffer[] = [];
    response.on("data", (chunk: Uint8Array) => bytes.push(Buffer.from(chunk)));
    await controller.download(
      user,
      { jobId, grantId: jobId },
      { cookies: { cra_list_export: "opaque" } } as unknown as Request,
      response,
    );
    expect(Buffer.concat(bytes).toString()).toBe("approved");
    expect(cleanup).toHaveBeenCalled();
    expect(setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "private, no-store",
    );
  });
  it("checks product path/body identity", async () => {
    const readiness = new ProductReadinessExportsController(
      methods as unknown as ExportsUseCases,
    );
    await expect(
      readiness.create(
        user,
        { productId: jobId },
        { productId: "other", idempotencyKey: jobId },
      ),
    ).rejects.toMatchObject({ status: 400 });
    methods.createReadiness.mockResolvedValue({ id: jobId });
    expect(
      await readiness.create(
        user,
        { productId: jobId },
        { productId: jobId, idempotencyKey: jobId },
      ),
    ).toEqual({ data: { id: jobId } });
  });
});
