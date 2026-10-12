import { PassThrough, Readable } from "node:stream";
import type { Response } from "express";
import { createExportJobSchema } from "@repo/contracts/exports";
import {
  PortalExportsController,
  portalSubject,
  assertPortalExportOrigin,
} from "./portal-exports.controller";
import { ExportAccessDeniedError } from "./domain/export.errors";
import type { Request } from "express";
import type { ConfigService } from "@nestjs/config";
import type { PortalExportsUseCases } from "./application/portal-exports.use-cases";
const id = "99514f0e-2ce0-456c-92d7-f0229dfd6e47";
const request = (
  path: string,
  headers: Record<string, string> = {},
  cookies: Record<string, string> = {},
) => ({ path, headers, cookies }) as unknown as Request;
describe("portal HTTP export isolation", () => {
  const config = {
    get: (key: string) => (key === "APP_URL" ? "http://localhost:3000" : false),
  } as unknown as ConfigService;
  const get = jest.fn();
  const manifest = jest.fn();
  const controller = new PortalExportsController(
    { get, manifest } as unknown as PortalExportsUseCases,
    config,
  );
  it("requires original session header for supplier route", () => {
    expect(() =>
      portalSubject(request("/api/v1/supplier-evidence-portal/exports")),
    ).toThrow(ExportAccessDeniedError);
    expect(
      portalSubject(
        request("/api/v1/supplier-evidence-portal/exports", {
          "x-supplier-evidence-session": "a".repeat(64),
        }),
      ).kind,
    ).toBe("supplier_session");
  });
  it("requires original auditor cookie and ignores supplier header on auditor route", () => {
    expect(() =>
      portalSubject(
        request("/api/v1/auditor/exports", {
          "x-supplier-evidence-session": "a".repeat(64),
        }),
      ),
    ).toThrow(ExportAccessDeniedError);
    expect(
      portalSubject(
        request("/api/v1/auditor/exports", {}, { cra_auditor: "a".repeat(64) }),
      ).kind,
    ).toBe("auditor_session");
  });
  it("rejects unrelated route paths", () =>
    expect(() =>
      portalSubject(
        request("/api/v1/products", {}, { cra_auditor: "a".repeat(64) }),
      ),
    ).toThrow(ExportAccessDeniedError));
  it("delivers manifest using only the original portal principal", async () => {
    manifest.mockResolvedValue({ version: "m14_03_v1" });
    expect(
      await controller.manifest(
        request("/api/v1/auditor/exports", {}, { cra_auditor: "a".repeat(64) }),
        { jobId: id },
      ),
    ).toEqual({ data: { version: "m14_03_v1" } });
    expect(manifest).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "auditor_session" }),
      id,
    );
  });
  it("passes derived session to self-owned status without tenant body", async () => {
    get.mockResolvedValue({ id });
    await expect(
      controller.get(
        request("/api/v1/auditor/exports", {}, { cra_auditor: "a".repeat(64) }),
        { jobId: id },
      ),
    ).resolves.toEqual({ data: { id } });
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "auditor_session" }),
      id,
    );
  });
});

describe("portal export operations", () => {
  const id = "99514f0e-2ce0-456c-92d7-f0229dfd6e47";
  const methods = {
    create: jest.fn(),
    list: jest.fn(),
    get: jest.fn(),
    mutate: jest.fn(),
    grant: jest.fn(),
    download: jest.fn(),
  };
  const config = {
    get: (key: string) =>
      key === "APP_URL"
        ? "http://localhost:3000"
        : key === "COOKIE_SECURE"
          ? true
          : key === "COOKIE_DOMAIN"
            ? "example.test"
            : undefined,
  } as unknown as ConfigService;
  const controller = new PortalExportsController(
    methods as unknown as PortalExportsUseCases,
    config,
  );
  const supplier = request("/api/v1/supplier-evidence-portal/exports", {
    "x-supplier-evidence-session": "a".repeat(64),
    origin: "http://localhost:3000",
  });
  beforeEach(() => jest.clearAllMocks());
  it("queues only parsed portal input", async () => {
    const input = createExportJobSchema.parse({
      source: "supplier_evidence.portal_items",
      context: {},
      filters: {},
      format: "csv",
      idempotencyKey: id,
    });
    methods.create.mockResolvedValue({ id });
    expect(await controller.create(supplier, input)).toEqual({ data: { id } });
  });
  it("passes scoped lists", async () => {
    methods.list.mockResolvedValue({ data: [], nextCursor: null });
    expect(await controller.list(supplier, { limit: 25 })).toEqual({
      data: [],
      nextCursor: null,
    });
  });
  it.each(["cancel", "retry"] as const)(
    "preserves version and request identity for %s",
    async (operation) => {
      methods.mutate.mockResolvedValue({ id });
      expect(
        await controller[operation](
          supplier,
          { jobId: id },
          { expectedVersion: 2, idempotencyKey: id },
        ),
      ).toEqual({ data: { id } });
      expect(methods.mutate).toHaveBeenCalledWith(
        expect.anything(),
        id,
        2,
        id,
        operation,
      );
    },
  );
  it("sets narrow cookies only for authorized supplier delivery", async () => {
    const downloadPath = `/api/v1/supplier-evidence-portal/exports/${id}/download/${id}`;
    const grant = {
      grantId: id,
      downloadPath,
      expiresAt: "2026-10-09T00:05:00Z",
    };
    methods.grant.mockResolvedValue({ grant, cookieValue: "b".repeat(64) });
    const response = { cookie: jest.fn() };
    expect(
      await controller.grant(
        supplier,
        { jobId: id },
        { artifactId: id },
        response as unknown as Response,
      ),
    ).toEqual({ data: grant });
    expect(response.cookie).toHaveBeenCalledWith(
      "cra_supplier_export_session",
      "a".repeat(64),
      expect.objectContaining({
        path: downloadPath,
        httpOnly: true,
        sameSite: "strict",
        maxAge: 300000,
      }),
    );
    expect(response.cookie).toHaveBeenCalledWith(
      "cra_portal_export",
      "b".repeat(64),
      expect.objectContaining({ path: downloadPath }),
    );
  });
  it("refuses a widened or mismatched delivery path", async () => {
    methods.grant.mockResolvedValue({
      grant: { grantId: id, downloadPath: "/api/v1/" },
      cookieValue: "opaque",
    });
    await expect(
      controller.grant(supplier, { jobId: id }, { artifactId: id }, {
        cookie: jest.fn(),
      } as unknown as Response),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("accepts auxiliary supplier credential only on binary delivery", () => {
    const delivery = request(
      `/api/v1/supplier-evidence-portal/exports/${id}/download/${id}`,
      {},
      { cra_supplier_export_session: "a".repeat(64) },
    );
    expect(() => portalSubject(delivery)).toThrow(ExportAccessDeniedError);
    expect(portalSubject(delivery, true).kind).toBe("supplier_session");
  });
  it("does not require an organization-member cookie", async () => {
    methods.get.mockResolvedValue({ id });
    expect(await controller.get(supplier, { jobId: id })).toEqual({
      data: { id },
    });
  });
  it("rejects cross-site and unexpected-origin mutations", () => {
    expect(() =>
      assertPortalExportOrigin(
        request(supplier.path, {
          "x-supplier-evidence-session": "a".repeat(64),
          origin: "http://evil.test",
        }),
        "http://localhost:3000",
      ),
    ).toThrow(ExportAccessDeniedError);
    expect(() =>
      assertPortalExportOrigin(
        request(supplier.path, { "sec-fetch-site": "cross-site" }),
        "http://localhost:3000",
      ),
    ).toThrow(ExportAccessDeniedError);
    expect(() =>
      assertPortalExportOrigin(
        request(supplier.path, { origin: "invalid" }),
        undefined,
      ),
    ).toThrow(ExportAccessDeniedError);
  });
  it("requires auditor origin for cookie mutations", () => {
    expect(() =>
      assertPortalExportOrigin(
        request("/api/v1/auditor/exports", {}, { cra_auditor: "a".repeat(64) }),
        "http://localhost:3000",
      ),
    ).toThrow(ExportAccessDeniedError);
    expect(() =>
      assertPortalExportOrigin(supplier, "http://localhost:3000"),
    ).not.toThrow();
    expect(() =>
      assertPortalExportOrigin(
        request(supplier.path, {
          "x-supplier-evidence-session": "a".repeat(64),
        }),
        "http://localhost:3000",
      ),
    ).not.toThrow();
  });
  it("streams and cleans verified private bytes using narrow delivery cookies", async () => {
    const response = new PassThrough() as unknown as Response;
    const setHeader = jest.fn();
    response.setHeader = setHeader;
    response.clearCookie = jest.fn();
    const cleanup = jest.fn().mockResolvedValue(undefined);
    methods.download.mockResolvedValue({
      body: Readable.from(["approved"]),
      byteLength: 8,
      sha256: "b".repeat(64),
      mediaType: "text/csv",
      name: "part.csv",
      cleanup,
    });
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Uint8Array) => chunks.push(Buffer.from(chunk)));
    await controller.download(
      request(
        `/api/v1/supplier-evidence-portal/exports/${id}/download/${id}`,
        {},
        {
          cra_supplier_export_session: "a".repeat(64),
          cra_portal_export: "b".repeat(64),
        },
      ),
      { jobId: id, grantId: id },
      response,
    );
    expect(Buffer.concat(chunks).toString()).toBe("approved");
    expect(cleanup).toHaveBeenCalled();
    expect(setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "private, no-store",
    );
  });
});
