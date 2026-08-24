import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../_lib/http/api-client";
import { sbomsApi } from "./sboms.api";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_ID = "22222222-2222-4222-8222-222222222222";
const UPLOAD_ID = "33333333-3333-4333-8333-333333333333";
const SOURCE_ID = "44444444-4444-4444-8444-444444444444";
const JOB_ID = "55555555-5555-4555-8555-555555555555";
const CREDENTIAL_ID = "66666666-6666-4666-8666-666666666666";
const DOCUMENT_ID = "77777777-7777-4777-8777-777777777777";
const COMPONENT_ID = "88888888-8888-4888-8888-888888888888";
const NOW = "2026-08-20T12:00:00.000Z";
const IDEMPOTENCY_KEY = "77777777-7777-4777-8777-777777777777";

const SOURCE = {
  id: SOURCE_ID,
  organizationId: "88888888-8888-4888-8888-888888888888",
  productId: PRODUCT_ID,
  releaseId: RELEASE_ID,
  source: "manual_upload",
  fileName: "firmware.cdx.json",
  mediaType: "application/vnd.cyclonedx+json",
  byteSize: 42,
  sha256: "a".repeat(64),
  status: "upload_pending",
  createdAt: NOW,
  completedAt: null,
} as const;

const JOB = {
  id: JOB_ID,
  organizationId: SOURCE.organizationId,
  sourceId: SOURCE_ID,
  releaseId: RELEASE_ID,
  inputSha256: SOURCE.sha256,
  correlationId: "99999999-9999-4999-8999-999999999999",
  status: "queued",
  progress: { stage: "queued", percent: 0, message: "Queued" },
  attempts: 0,
  maxAttempts: 5,
  error: null,
  result: null,
  createdAt: NOW,
  updatedAt: NOW,
  completedAt: null,
} as const;
const JOB_RESPONSE = {
  job: JOB,
  progressUrl: `/api/v1/sbom-jobs/${JOB_ID}`,
} as const;
const SOURCE_HISTORY_RESPONSE = {
  sources: [
    {
      source: {
        ...SOURCE,
        status: "verified",
        declaredFormat: "cyclonedx",
        declaredSpecVersion: "1.6",
        completedAt: NOW,
      },
      validation: {
        status: "valid_with_warnings",
        errorCount: 0,
        warningCount: 1,
        omittedDiagnosticCount: 0,
        completedAt: NOW,
      },
    },
  ],
  nextCursor: null,
} as const;
const VALIDATION_REPORT_RESPONSE = {
  source: SOURCE_HISTORY_RESPONSE.sources[0].source,
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
    completedAt: NOW,
  },
} as const;

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}

describe("sbomsApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("initializes a release-bound upload only through the parsed versioned route", async () => {
    const fetcher = vi.fn(async () =>
      json({
        source: SOURCE,
        upload: {
          uploadUrl: "https://storage.test/upload",
          expiresAt: NOW,
        },
      }),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(
      sbomsApi.initializeUpload({
        productId: PRODUCT_ID,
        releaseId: RELEASE_ID,
        fileName: SOURCE.fileName,
        mediaType: SOURCE.mediaType,
        byteSize: SOURCE.byteSize,
        sha256: SOURCE.sha256,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).resolves.toMatchObject({ source: SOURCE });

    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/products/${PRODUCT_ID}/releases/${RELEASE_ID}/sbom-uploads`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
  });

  it("rejects invalid client metadata before transport", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    expect(() =>
      sbomsApi.initializeUpload({
        productId: PRODUCT_ID,
        releaseId: RELEASE_ID,
        fileName: "../outside.json",
        mediaType: SOURCE.mediaType,
        byteSize: 0,
        sha256: SOURCE.sha256,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).toThrow(ApiClientError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("completes and reads durable jobs through opaque parsed identifiers", async () => {
    const fetcher = vi.fn(async (path: string) => {
      if (path.endsWith("/complete")) return json(JOB_RESPONSE, 202);
      return json(JOB_RESPONSE);
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(
      sbomsApi.completeUpload(UPLOAD_ID, { idempotencyKey: IDEMPOTENCY_KEY }),
    ).resolves.toEqual(JOB_RESPONSE);
    await expect(sbomsApi.getJob(JOB_ID)).resolves.toEqual(JOB_RESPONSE);

    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      `/api/v1/sbom-uploads/${UPLOAD_ID}/complete`,
      `/api/v1/sbom-jobs/${JOB_ID}`,
    ]);
  });

  it("lists release source history and reads validation reports through parsed GET routes", async () => {
    const fetcher = vi.fn(async (path: string) => {
      if (path.includes("/sbom-sources?")) {
        return json(SOURCE_HISTORY_RESPONSE);
      }
      return json(VALIDATION_REPORT_RESPONSE);
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(
      sbomsApi.listSourcesForRelease(PRODUCT_ID, RELEASE_ID, {
        limit: 10,
        cursor: "next/page",
      }),
    ).resolves.toEqual(SOURCE_HISTORY_RESPONSE);
    await expect(sbomsApi.getValidationReport(SOURCE_ID)).resolves.toEqual(
      VALIDATION_REPORT_RESPONSE,
    );

    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      `/api/v1/products/${PRODUCT_ID}/releases/${RELEASE_ID}/sbom-sources?limit=10&cursor=next%2Fpage`,
      `/api/v1/sbom-sources/${SOURCE_ID}/validation-report`,
    ]);
  });

  it("reads normalized documents, components, and dependency children only through parsed versioned routes", async () => {
    const document = {
      id: DOCUMENT_ID,
      sourceId: SOURCE_ID,
      format: "cyclonedx",
      specificationVersion: "1.6",
      parser: { name: "CRA parser", version: "1.0.0" },
      normalizer: { name: "CRA normalizer", version: "1.0.0" },
      state: "completed",
      validationStatus: "valid",
      componentCount: 1,
      dependencyCount: 0,
      maximumDepth: 0,
      warningCount: 0,
      error: null,
      completedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    } as const;
    const component = {
      id: COMPONENT_ID,
      documentId: DOCUMENT_ID,
      documentLocalRef: "pkg:npm/example@1.0.0",
      originalName: "Example",
      normalizedName: "example",
      originalVersion: "1.0.0",
      normalizedVersion: "1.0.0",
      originalPurl: "pkg:npm/example@1.0.0",
      canonicalPurl: "pkg:npm/example@1.0.0",
      cpe: null,
      ecosystem: "npm",
      scope: null,
      supplier: null,
      licenseExpression: null,
      hashes: [],
      depth: 0,
      parentComponentId: null,
      sourceLocation: { path: "/components/0", byteStart: 0, byteEnd: 1, line: 1 },
    } as const;
    const fetcher = vi.fn(async (path: string) => {
      if (path.includes("dependency-tree")) {
        return json({ items: [{ component, childCount: 0 }], nextCursor: null });
      }
      if (path.includes("/components")) {
        return json({ components: [component], nextCursor: null });
      }
      if (path === `/api/v1/sbom-documents/${DOCUMENT_ID}`) {
        return json({ document, diagnostics: [] });
      }
      return json({ documents: [document], nextCursor: null });
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(
      sbomsApi.listDocumentsForRelease(PRODUCT_ID, RELEASE_ID, {
        limit: 10,
        cursor: "next/page",
      }),
    ).resolves.toEqual({ documents: [document], nextCursor: null });
    await expect(sbomsApi.getDocument(DOCUMENT_ID)).resolves.toEqual({
      document,
      diagnostics: [],
    });
    await expect(
      sbomsApi.searchComponents(DOCUMENT_ID, { q: "example", limit: 10 }),
    ).resolves.toEqual({ components: [component], nextCursor: null });
    await expect(
      sbomsApi.listDependencyTreeChildren(DOCUMENT_ID, {
        parentComponentId: COMPONENT_ID,
        limit: 10,
      }),
    ).resolves.toEqual({
      items: [{ component, childCount: 0 }],
      nextCursor: null,
    });

    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      `/api/v1/products/${PRODUCT_ID}/releases/${RELEASE_ID}/sbom-documents?limit=10&cursor=next%2Fpage`,
      `/api/v1/sbom-documents/${DOCUMENT_ID}`,
      `/api/v1/sbom-documents/${DOCUMENT_ID}/components?q=example&limit=10`,
      `/api/v1/sbom-documents/${DOCUMENT_ID}/dependency-tree?parentComponentId=${COMPONENT_ID}&limit=10`,
    ]);
  });

  it("declares unknown browser file types as octet-stream for storage upload", async () => {
    const headers = new Map<string, string>();
    class FakeXmlHttpRequest {
      status = 200;
      upload = {};
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      open = vi.fn();
      setRequestHeader(name: string, value: string) {
        headers.set(name, value);
      }
      send() {
        this.onload?.();
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXmlHttpRequest);

    await expect(
      sbomsApi.uploadOriginal(
        "https://storage.test/upload",
        new File(["{}"], "vendor.sbom", { type: "" }),
      ),
    ).resolves.toBeUndefined();
    expect(headers.get("content-type")).toBe("application/octet-stream");
  });

  it("creates, lists, and revokes CI credentials through owner routes", async () => {
    const credential = {
      id: CREDENTIAL_ID,
      organizationId: SOURCE.organizationId,
      label: "GitHub Actions",
      tokenPrefix: "cra_sbom_abcdefgh",
      createdAt: NOW,
      createdBy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      revokedAt: null,
      revokedBy: null,
      lastUsedAt: null,
    };
    const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST" && path.endsWith("/revoke")) {
        return json({ credential: { ...credential, revokedAt: NOW } });
      }
      if (init?.method === "POST") {
        return json({ credential, secret: `cra_sbom_${"s".repeat(32)}` }, 201);
      }
      return json({ credentials: [credential] });
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(sbomsApi.listCiCredentials()).resolves.toEqual({
      credentials: [credential],
    });
    await expect(
      sbomsApi.createCiCredential({
        label: "GitHub Actions",
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).resolves.toMatchObject({ secret: `cra_sbom_${"s".repeat(32)}` });
    await expect(
      sbomsApi.revokeCiCredential(CREDENTIAL_ID, {
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).resolves.toMatchObject({ credential: { revokedAt: NOW } });
  });
});
