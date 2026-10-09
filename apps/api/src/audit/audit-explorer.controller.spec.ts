import { Readable, PassThrough } from "node:stream";

import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";

import {
  AUDIT_EXPORT_GRANT_COOKIE,
  AuditExplorerController,
} from "./audit-explorer.controller";
import {
  AuditExplorerNotFoundError,
  AuditExplorerStaleError,
  AuditExplorerUnavailableError,
} from "./audit-explorer.errors";

describe("AuditExplorerController", () => {
  it("declares the approved audit explorer route paths", () => {
    const routes = [
      "search",
      "page",
      "detail",
      "verify",
      "createExport",
      "exportStatus",
      "downloadGrant",
      "download",
    ] as const;

    expect(
      Object.fromEntries(
        routes.map((name) => [
          name,
          Reflect.getMetadata(PATH_METADATA, routeHandler(name)),
        ]),
      ),
    ).toEqual({
      search: "searches",
      page: "searches/:snapshotToken/events",
      detail: "searches/:snapshotToken/events/:eventId",
      verify: "searches/:snapshotToken/verify",
      createExport: "exports",
      exportStatus: "exports/:jobId",
      downloadGrant: "exports/:jobId/download-grants",
      download: "exports/:jobId/download",
    });

    expect(Reflect.getMetadata(METHOD_METADATA, routeHandler("download"))).toBe(
      0,
    );
    expect(AUDIT_EXPORT_GRANT_COOKIE).toBe("cra_audit_export");
  });

  it("delegates JSON routes through the use case boundary", async () => {
    const audit = {
      createSnapshot: jest.fn().mockResolvedValue({
        snapshotToken: "token",
        expiresAt: "2026-10-07T00:00:00.000Z",
        filters: {},
      }),
      page: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
      detail: jest.fn().mockResolvedValue({
        event: {},
        before: null,
        after: null,
        reason: null,
      }),
      verify: jest.fn().mockResolvedValue({
        checkedAt: "2026-10-07T00:00:00.000Z",
        items: [],
        completenessProven: false,
        authenticityProven: false,
      }),
      createExport: jest.fn().mockResolvedValue({ id: "job" }),
      getExport: jest.fn().mockResolvedValue({ id: "job" }),
      issueDownloadGrant: jest.fn().mockResolvedValue({
        grant: {
          url: "/api/v1/audit/exports/33333333-3333-4333-8333-333333333333/download",
          expiresAt: "2026-10-07T00:00:00.000Z",
          packageHash: "a".repeat(64),
        },
        cookieValue: "cookie",
        cookieMaxAge: 300,
      }),
    };
    const controller = new AuditExplorerController(
      audit as never,
      { get: () => false } as never,
    );
    const user = { id: "user" } as never;
    const response = { cookie: jest.fn() } as never;

    await controller.search(user, {
      requestId: "r",
      filters: {
        from: "2026-10-07T00:00:00.000Z",
        to: "2026-10-08T00:00:00.000Z",
      },
    });
    await controller.page(
      user,
      { snapshotToken: "s" },
      {
        requestId: "r",
        limit: 1,
      },
    );
    await controller.detail(
      user,
      { snapshotToken: "s", eventId: "e" },
      { requestId: "r" },
    );
    await controller.verify(
      user,
      { snapshotToken: "s" },
      {
        requestId: "r",
        eventIds: [],
      },
    );
    await controller.createExport(user, {
      requestId: "r",
      snapshotToken: "s",
      format: "json",
    });
    await controller.exportStatus(user, { jobId: "j" }, { requestId: "r" });
    await controller.downloadGrant(
      user,
      { jobId: "j" },
      { requestId: "r" },
      response,
    );

    expect(audit.createSnapshot).toHaveBeenCalled();
    expect(audit.page).toHaveBeenCalled();
    expect(audit.detail).toHaveBeenCalled();
    expect(audit.verify).toHaveBeenCalled();
    expect(audit.createExport).toHaveBeenCalled();
    expect(audit.getExport).toHaveBeenCalled();
    expect(audit.issueDownloadGrant).toHaveBeenCalled();
  });

  it("maps application errors to stable HTTP exceptions", async () => {
    for (const [error, status] of [
      [new AuditExplorerNotFoundError(), 404],
      [new AuditExplorerStaleError(), 409],
      [new AuditExplorerUnavailableError(), 503],
    ] as const) {
      const controller = new AuditExplorerController(
        { createSnapshot: jest.fn().mockRejectedValue(error) } as never,
        { get: () => false } as never,
      );
      await expect(
        controller.search(
          { id: "user" } as never,
          {
            requestId: "r",
            filters: {},
          } as never,
        ),
      ).rejects.toMatchObject({ status });
    }
  });

  it("rethrows unexpected application errors", async () => {
    const error = new Error("unexpected");
    const controller = new AuditExplorerController(
      { createSnapshot: jest.fn().mockRejectedValue(error) } as never,
      { get: () => false } as never,
    );

    await expect(
      controller.search(
        { id: "user" } as never,
        { requestId: "r", filters: {} } as never,
      ),
    ).rejects.toBe(error);
  });

  it("cleans verified archive files when streaming fails", async () => {
    const cleanup = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    const body = new Readable({
      read() {
        this.destroy(new Error("client aborted"));
      },
    });
    const audit = {
      download: jest.fn().mockResolvedValue({
        body,
        contentLength: 10,
        packageHash: "a".repeat(64),
        cleanup,
      }),
    };
    const controller = new AuditExplorerController(
      audit as never,
      { get: () => false } as never,
    );
    const response = new PassThrough() as PassThrough & {
      setHeader: jest.Mock;
      clearCookie: jest.Mock;
    };
    response.setHeader = jest.fn();
    response.clearCookie = jest.fn();

    await expect(
      controller.download(
        { id: "user" } as never,
        { jobId: "33333333-3333-4333-8333-333333333333" },
        { requestId: "44444444-4444-4444-8444-444444444444" },
        { cookies: { [AUDIT_EXPORT_GRANT_COOKIE]: "grant" } } as never,
        response as never,
      ),
    ).rejects.toThrow("client aborted");
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

function routeHandler(name: keyof AuditExplorerController): object {
  const descriptor = Object.getOwnPropertyDescriptor(
    AuditExplorerController.prototype,
    name,
  );
  const value = descriptor?.value as unknown;
  if (typeof value !== "function") {
    throw new Error(`Missing route ${String(name)}`);
  }
  return value;
}

it("sets and clears strict download cookies with configured domain and secure flag", async () => {
  const jobId = "33333333-3333-4333-8333-333333333333";
  const audit = {
    issueDownloadGrant: jest.fn().mockResolvedValue({
      grant: {
        url: `/api/v1/audit/exports/${jobId}/download`,
        expiresAt: "2026-10-07T00:00:00.000Z",
        packageHash: "a".repeat(64),
      },
      cookieValue: "grant-cookie",
      cookieMaxAge: 300,
    }),
    download: jest.fn().mockResolvedValue({
      body: Readable.from(Buffer.from("zip-bytes")),
      contentLength: 9,
      packageHash: "a".repeat(64),
      cleanup: jest.fn().mockResolvedValue(undefined),
    }),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === "COOKIE_SECURE"
        ? true
        : key === "COOKIE_DOMAIN"
          ? ".cra.test"
          : undefined,
    ),
  };
  const controller = new AuditExplorerController(
    audit as never,
    config as never,
  );
  const grantResponse = { cookie: jest.fn() };

  await controller.downloadGrant(
    { id: "user" } as never,
    { jobId },
    { requestId: "44444444-4444-4444-8444-444444444444" },
    grantResponse as never,
  );

  expect(grantResponse.cookie).toHaveBeenCalledWith(
    AUDIT_EXPORT_GRANT_COOKIE,
    "grant-cookie",
    expect.objectContaining({
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      domain: ".cra.test",
      path: `/api/v1/audit/exports/${jobId}/download`,
      maxAge: 300_000,
    }),
  );

  const downloadResponse = new PassThrough() as PassThrough & {
    setHeader: jest.Mock;
    clearCookie: jest.Mock;
  };
  downloadResponse.setHeader = jest.fn();
  downloadResponse.clearCookie = jest.fn();
  await controller.download(
    { id: "user" } as never,
    { jobId },
    { requestId: "55555555-5555-4555-8555-555555555555" },
    { cookies: undefined } as never,
    downloadResponse as never,
  );

  expect(audit.download).toHaveBeenCalledWith(
    expect.anything(),
    jobId,
    "55555555-5555-4555-8555-555555555555",
    undefined,
  );
  expect(downloadResponse.clearCookie).toHaveBeenCalledWith(
    AUDIT_EXPORT_GRANT_COOKIE,
    expect.objectContaining({
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      domain: ".cra.test",
      path: `/api/v1/audit/exports/${jobId}/download`,
    }),
  );
});

it("omits cookie domain and defaults secure false when config is absent", async () => {
  const jobId = "33333333-3333-4333-8333-333333333333";
  const audit = {
    issueDownloadGrant: jest.fn().mockResolvedValue({
      grant: {
        url: `/api/v1/audit/exports/${jobId}/download`,
        expiresAt: "2026-10-07T00:00:00.000Z",
        packageHash: "a".repeat(64),
      },
      cookieValue: "grant-cookie",
      cookieMaxAge: 300,
    }),
  };
  const response: {
    cookie: jest.Mock<void, [string, string, Record<string, unknown>]>;
  } = { cookie: jest.fn<void, [string, string, Record<string, unknown>]>() };
  const controller = new AuditExplorerController(
    audit as never,
    { get: () => undefined } as never,
  );

  await controller.downloadGrant(
    { id: "user" } as never,
    { jobId },
    { requestId: "44444444-4444-4444-8444-444444444444" },
    response as never,
  );

  expect(response.cookie).toHaveBeenCalledTimes(1);
  const options = response.cookie.mock.calls[0]?.[2];
  expect(options).toMatchObject({ secure: false });
  expect(options).not.toHaveProperty("domain");
});
