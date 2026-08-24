import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import {
  sbomQualityFindingsResponseSchema,
  sbomQualityReportResponseSchema,
  sbomQualitySettingsResponseSchema,
  sbomSourceHistoryResponseSchema,
  sbomDocumentListResponseSchema,
  sbomValidationReportResponseSchema,
  type SbomSourceHistoryResponse,
  type SbomValidationReportResponse,
} from "@repo/contracts/sboms";

import { REQUIRE_PERMISSIONS_KEY, type RequestUser } from "../auth/auth.types";
import { ZOD_RESPONSE_SCHEMA } from "../common/http/zod-response.interceptor";
import {
  ProductReleaseSbomController,
  SbomDocumentsController,
  SbomCiController,
  SbomQualitySettingsController,
  SbomSourcesController,
} from "./sbom.controller";

const organizationId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";
const releaseId = "00000000-0000-4000-8000-000000000003";
const sourceId = "00000000-0000-4000-8000-000000000004";
const actorId = "00000000-0000-4000-8000-000000000005";
const supersededSourceId = "00000000-0000-4000-8000-000000000007";
const now = "2026-08-21T04:00:00.000Z";
const hash = "a".repeat(64);

const source = Object.freeze({
  id: sourceId,
  organizationId,
  productId,
  releaseId,
  source: "manual_upload",
  fileName: "sentinel.cdx.json",
  mediaType: "application/vnd.cyclonedx+json",
  byteSize: 1024,
  sha256: hash,
  status: "verified",
  declaredFormat: "cyclonedx",
  declaredSpecVersion: "1.6",
  createdAt: now,
  completedAt: now,
} as const);

const history: SbomSourceHistoryResponse = {
  sources: [
    {
      source,
      validation: {
        status: "valid_with_warnings",
        errorCount: 0,
        warningCount: 1,
        omittedDiagnosticCount: 0,
        completedAt: now,
      },
    },
  ],
  nextCursor: null,
};

const report: SbomValidationReportResponse = {
  source,
  report: {
    status: "valid_with_warnings",
    detected: {
      format: "cyclonedx",
      serialization: "json",
      specificationVersion: "1.6",
    },
    validator: {
      name: "CRA SBOM validator",
      version: "1.0.0",
      schemaAssetSha256: "a".repeat(64),
    },
    diagnostics: [
      {
        severity: "warning",
        code: "missing-license",
        location: "components[0].licenses",
        message: "The component is missing license metadata.",
        remediation: "Add a declared license to the component entry.",
      },
    ],
    errorCount: 0,
    warningCount: 1,
    omittedDiagnosticCount: 0,
    completedAt: now,
  },
};

const user: RequestUser = Object.freeze({
  id: actorId,
  authUserId: "00000000-0000-4000-8000-000000000006",
  email: "owner@cra.test",
  isActive: true,
  organizationId,
  role: "owner",
  accessToken: "access-token",
  aal: "aal2",
});

function handler<T extends object>(controller: T, name: keyof T): object {
  const prototype = Object.getPrototypeOf(controller) as Record<
    PropertyKey,
    unknown
  >;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
  const value: unknown = descriptor?.value;
  if (typeof value !== "function") throw new Error(`Missing ${String(name)}`);
  return value;
}

describe("SBOM report controllers", () => {
  it("keeps completed document reads tenant-scoped and permission-gated", async () => {
    const documents = { documents: [], nextCursor: null };
    const service = { listDocuments: jest.fn().mockResolvedValue(documents) };
    const controller = new ProductReleaseSbomController(service as never);
    const routeHandler = handler(controller, "documents");

    expect(Reflect.getMetadata(PATH_METADATA, routeHandler)).toBe(
      "sbom-documents",
    );
    expect(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, routeHandler)).toEqual([
      "can_view_sboms",
    ]);
    expect(Reflect.getMetadata(ZOD_RESPONSE_SCHEMA, routeHandler)).toBe(
      sbomDocumentListResponseSchema,
    );
    await expect(
      controller.documents({ productId, releaseId }, { limit: 25 }, user),
    ).resolves.toEqual(documents);
    expect(service.listDocuments).toHaveBeenCalledWith({
      organizationId,
      actorId,
      productId,
      releaseId,
      limit: 25,
      cursor: undefined,
    });
  });

  it("passes only the authenticated organization into document component reads", async () => {
    const service = {
      searchComponents: jest
        .fn()
        .mockResolvedValue({ components: [], nextCursor: null }),
    };
    const controller = new SbomDocumentsController(service as never);

    await expect(
      controller.components({ documentId: sourceId }, { limit: 50 }, user),
    ).resolves.toEqual({ components: [], nextCursor: null });
    expect(service.searchComponents).toHaveBeenCalledWith({
      organizationId,
      actorId,
      documentId: sourceId,
      q: undefined,
      limit: 50,
      cursor: undefined,
    });
  });

  it("forwards untrusted CI declaration and correction metadata to the intake use case", async () => {
    const service = {
      initialize: jest.fn().mockResolvedValue({
        reservation: {
          id: sourceId,
          organizationId,
          productId,
          releaseId,
          source: "ci_upload",
          filename: source.fileName,
          mediaType: source.mediaType,
          byteSize: source.byteSize,
          sha256: hash,
          status: "upload_pending",
          createdAt: now,
          completedAt: null,
        },
        upload: {
          uploadUrl: "https://storage.test/sbom-upload",
          expiresAt: now,
        },
      }),
    };
    const controller = new SbomCiController(service as never);

    await controller.initialize(
      {
        productId,
        releaseId,
        fileName: source.fileName,
        mediaType: source.mediaType,
        byteSize: source.byteSize,
        sha256: hash,
        idempotencyKey: "00000000-0000-4000-8000-000000000009",
        source: "ci_upload",
        declaredFormat: "cyclonedx",
        declaredSpecVersion: "1.6",
        supersedesSourceId: supersededSourceId,
      },
      { sbomCiPrincipal: { organizationId, credentialId: actorId } } as never,
    );

    expect(service.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        declaredFormat: "cyclonedx",
        declaredSpecVersion: "1.6",
        supersedesSourceId: supersededSourceId,
      }),
    );
  });

  it("forwards corrected upload metadata to the release upload use case", async () => {
    const service = {
      initialize: jest.fn().mockResolvedValue({
        reservation: {
          id: "00000000-0000-4000-8000-000000000008",
          organizationId,
          productId,
          releaseId,
          source: "manual_upload",
          filename: source.fileName,
          mediaType: source.mediaType,
          byteSize: source.byteSize,
          sha256: hash,
          status: "upload_pending",
          createdAt: now,
          completedAt: null,
        },
        upload: {
          uploadUrl: "https://storage.test/sbom-upload",
          expiresAt: now,
        },
      }),
    };
    const controller = new ProductReleaseSbomController(service as never);

    await controller.initialize(
      { productId, releaseId },
      {
        productId,
        releaseId,
        fileName: source.fileName,
        mediaType: source.mediaType,
        byteSize: source.byteSize,
        sha256: hash,
        idempotencyKey: "00000000-0000-4000-8000-000000000009",
        source: "manual_upload",
        declaredFormat: "cyclonedx",
        declaredSpecVersion: "1.6",
        supersedesSourceId: supersededSourceId,
      },
      user,
    );

    expect(service.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        declaredFormat: "cyclonedx",
        declaredSpecVersion: "1.6",
        supersedesSourceId: supersededSourceId,
      }),
    );
  });

  it("keeps release source history on the release route with view permission and a parsed response", async () => {
    const service = {
      listSourcesForRelease: jest.fn().mockResolvedValue(history),
    };
    const controller = new ProductReleaseSbomController(service as never);
    const routeHandler = handler(controller, "sources");

    expect(
      Reflect.getMetadata(PATH_METADATA, ProductReleaseSbomController),
    ).toBe("products/:productId/releases/:releaseId");
    expect(Reflect.getMetadata(PATH_METADATA, routeHandler)).toBe(
      "sbom-sources",
    );
    expect(Reflect.getMetadata(METHOD_METADATA, routeHandler)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, routeHandler)).toEqual([
      "can_view_sboms",
    ]);
    expect(Reflect.getMetadata(ZOD_RESPONSE_SCHEMA, routeHandler)).toBe(
      sbomSourceHistoryResponseSchema,
    );

    await expect(
      controller.sources(
        { productId, releaseId },
        { limit: 5, cursor: "cursor-1" },
        user,
      ),
    ).resolves.toEqual(history);
    expect(service.listSourcesForRelease).toHaveBeenCalledWith({
      organizationId,
      actorId,
      productId,
      releaseId,
      limit: 5,
      cursor: "cursor-1",
    });
  });

  it("reads a validation report by source through indistinguishable tenant-scoped identity", async () => {
    const service = {
      validationReport: jest.fn().mockResolvedValue(report),
    };
    const controller = new SbomSourcesController(service as never);
    const routeHandler = handler(controller, "validationReport");

    expect(Reflect.getMetadata(PATH_METADATA, routeHandler)).toBe(
      ":sourceId/validation-report",
    );
    expect(Reflect.getMetadata(METHOD_METADATA, routeHandler)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, routeHandler)).toEqual([
      "can_view_sboms",
    ]);
    expect(Reflect.getMetadata(ZOD_RESPONSE_SCHEMA, routeHandler)).toBe(
      sbomValidationReportResponseSchema,
    );

    await expect(
      controller.validationReport({ sourceId }, user),
    ).resolves.toEqual(report);
    expect(service.validationReport).toHaveBeenCalledWith({
      organizationId,
      actorId,
      sourceId,
    });
  });

  it("reads source-scoped quality reports with view permission and parsed success output", async () => {
    const quality = { report: { id: "quality-report" } };
    const service = {
      qualityReport: jest.fn().mockResolvedValue(quality),
    };
    const controller = new SbomSourcesController(service as never);
    const routeHandler = handler(controller, "qualityReport");

    expect(Reflect.getMetadata(PATH_METADATA, routeHandler)).toBe(
      ":sourceId/quality-report",
    );
    expect(Reflect.getMetadata(METHOD_METADATA, routeHandler)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, routeHandler)).toEqual([
      "can_view_sboms",
    ]);
    expect(Reflect.getMetadata(ZOD_RESPONSE_SCHEMA, routeHandler)).toBe(
      sbomQualityReportResponseSchema,
    );

    await expect(controller.qualityReport({ sourceId }, user)).resolves.toBe(
      quality,
    );
    expect(service.qualityReport).toHaveBeenCalledWith({
      organizationId,
      actorId,
      sourceId,
    });
  });

  it("keeps paged quality findings source-scoped and server-filtered", async () => {
    const findings = { findings: [], nextCursor: null };
    const service = {
      qualityFindings: jest.fn().mockResolvedValue(findings),
    };
    const controller = new SbomSourcesController(service as never);
    const routeHandler = handler(controller, "qualityFindings");

    expect(Reflect.getMetadata(PATH_METADATA, routeHandler)).toBe(
      ":sourceId/quality-findings",
    );
    expect(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, routeHandler)).toEqual([
      "can_view_sboms",
    ]);
    expect(Reflect.getMetadata(ZOD_RESPONSE_SCHEMA, routeHandler)).toBe(
      sbomQualityFindingsResponseSchema,
    );

    await expect(
      controller.qualityFindings(
        { sourceId },
        { limit: 25, severity: "warning", kind: "coverage_gap" },
        user,
      ),
    ).resolves.toBe(findings);
    expect(service.qualityFindings).toHaveBeenCalledWith({
      organizationId,
      actorId,
      sourceId,
      limit: 25,
      cursor: undefined,
      severity: "warning",
      kind: "coverage_gap",
    });
  });

  it("keeps BSI quality settings owner-only and authenticated from the request", async () => {
    const settings = { settings: { version: 2 } };
    const service = {
      qualitySettings: jest.fn().mockResolvedValue(settings),
      updateQualitySettings: jest.fn().mockResolvedValue(settings),
    };
    const controller = new SbomQualitySettingsController(service as never);
    const getHandler = handler(controller, "settings");
    const patchHandler = handler(controller, "updateSettings");

    expect(Reflect.getMetadata(PATH_METADATA, controller.constructor)).toBe(
      "sbom-quality-settings",
    );
    expect(Reflect.getMetadata(ZOD_RESPONSE_SCHEMA, getHandler)).toBe(
      sbomQualitySettingsResponseSchema,
    );
    expect(Reflect.getMetadata(ZOD_RESPONSE_SCHEMA, patchHandler)).toBe(
      sbomQualitySettingsResponseSchema,
    );

    await expect(controller.settings(user)).resolves.toBe(settings);
    await expect(
      controller.updateSettings(
        {
          expectedVersion: 2,
          bsiProfileEnabled: true,
          idempotencyKey: "00000000-0000-4000-8000-000000000010",
        },
        user,
      ),
    ).resolves.toBe(settings);
    expect(service.qualitySettings).toHaveBeenCalledWith({
      organizationId,
      actorId,
    });
    expect(service.updateQualitySettings).toHaveBeenCalledWith({
      organizationId,
      actorId,
      expectedVersion: 2,
      bsiProfileEnabled: true,
      idempotencyKey: "00000000-0000-4000-8000-000000000010",
    });
  });
});
