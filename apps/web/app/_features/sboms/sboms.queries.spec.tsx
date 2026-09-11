// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  useRetrySbomDiffMutation,
  useSbomComponentSearchQuery,
  useSbomDependencyTreeChildrenQuery,
  useSbomDocumentDetailQuery,
  useSbomDocumentsForReleaseQuery,
  useSbomQualityFindingsQuery,
  useSbomQualityReportQuery,
  useSbomSourceDiffQuery,
  useSbomSourceHistoryQuery,
  useSbomValidationReportQuery,
} from "./sboms.queries";

const api = vi.hoisted(() => ({
  listDocumentsForRelease: vi.fn(),
  getDocument: vi.fn(),
  searchComponents: vi.fn(),
  listDependencyTreeChildren: vi.fn(),
  listSourcesForRelease: vi.fn(),
  getValidationReport: vi.fn(),
  getQualityReport: vi.fn(),
  listQualityFindings: vi.fn(),
  getSourceDiff: vi.fn(),
  retryDiff: vi.fn(),
}));

vi.mock("./sboms.api", () => ({
  sbomsApi: api,
}));

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_ID = "33333333-3333-4333-8333-333333333333";
const DIFF_ID = "99999999-9999-4999-8999-999999999999";
const NOW = "2026-08-21T04:00:00.000Z";

const source = {
  id: SOURCE_ID,
  organizationId: "44444444-4444-4444-8444-444444444444",
  productId: PRODUCT_ID,
  releaseId: RELEASE_ID,
  source: "manual_upload",
  fileName: "sentinel.cdx.json",
  mediaType: "application/vnd.cyclonedx+json",
  byteSize: 1024,
  sha256: "a".repeat(64),
  status: "verified",
  declaredFormat: "cyclonedx",
  declaredSpecVersion: "1.6",
  createdAt: NOW,
  completedAt: NOW,
} as const;
const history = {
  sources: [
    {
      source,
      validation: {
        status: "valid",
        errorCount: 0,
        warningCount: 0,
        omittedDiagnosticCount: 0,
        completedAt: NOW,
      },
    },
  ],
  nextCursor: null,
} as const;
const report = {
  source,
  report: {
    status: "valid",
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
    diagnostics: [],
    errorCount: 0,
    warningCount: 0,
    omittedDiagnosticCount: 0,
    completedAt: NOW,
  },
} as const;

function wrapper({ children }: Readonly<{ children: ReactNode }>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("SBOM queries", () => {
  afterEach(() => vi.clearAllMocks());

  it("uses a stable release source history key and forwards the parsed query", async () => {
    api.listSourcesForRelease.mockResolvedValue(history);

    const { result } = renderHook(
      () =>
        useSbomSourceHistoryQuery(
          PRODUCT_ID,
          RELEASE_ID,
          { limit: 5, cursor: "cursor-1" },
          true,
        ),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(history);
    expect(api.listSourcesForRelease).toHaveBeenCalledWith(
      PRODUCT_ID,
      RELEASE_ID,
      { limit: 5, cursor: "cursor-1" },
      expect.any(AbortSignal),
    );
  });

  it("reads a validation report only when a source is selected", async () => {
    api.getValidationReport.mockResolvedValue(report);

    const { result } = renderHook(
      () => useSbomValidationReportQuery(SOURCE_ID, true),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(report);
    expect(api.getValidationReport).toHaveBeenCalledWith(
      SOURCE_ID,
      expect.any(AbortSignal),
    );
  });

  it("uses document-scoped keys for the normalized graph views and forwards parsed cursors", async () => {
    const documentId = "55555555-5555-4555-8555-555555555555";
    const componentId = "66666666-6666-4666-8666-666666666666";
    const document = {
      id: documentId,
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
      id: componentId,
      documentId,
      documentLocalRef: "pkg:npm/example@1.0.0",
      originalName: "Example",
      normalizedName: "example",
      originalVersion: "1.0.0",
      normalizedVersion: "1.0.0",
      originalPurl: null,
      canonicalPurl: null,
      cpe: null,
      ecosystem: null,
      scope: null,
      supplier: null,
      licenseExpression: null,
      hashes: [],
      depth: 0,
      parentComponentId: null,
      sourceLocation: {
        path: "/components/0",
        byteStart: 0,
        byteEnd: 1,
        line: 1,
      },
    } as const;
    api.listDocumentsForRelease.mockResolvedValue({
      documents: [document],
      nextCursor: null,
    });
    api.getDocument.mockResolvedValue({ document, diagnostics: [] });
    api.searchComponents.mockResolvedValue({
      components: [component],
      nextCursor: null,
    });
    api.listDependencyTreeChildren.mockResolvedValue({
      items: [{ component, childCount: 0 }],
      nextCursor: null,
    });

    const { result } = renderHook(
      () => ({
        documents: useSbomDocumentsForReleaseQuery(
          PRODUCT_ID,
          RELEASE_ID,
          { limit: 10 },
          true,
        ),
        detail: useSbomDocumentDetailQuery(documentId, true),
        components: useSbomComponentSearchQuery(
          documentId,
          { q: "example", limit: 10 },
          true,
        ),
        children: useSbomDependencyTreeChildrenQuery(
          documentId,
          { parentComponentId: componentId, limit: 10 },
          true,
        ),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.children.isSuccess).toBe(true));
    expect(api.listDocumentsForRelease).toHaveBeenCalledWith(
      PRODUCT_ID,
      RELEASE_ID,
      { limit: 10 },
      expect.any(AbortSignal),
    );
    expect(api.getDocument).toHaveBeenCalledWith(
      documentId,
      expect.any(AbortSignal),
    );
    expect(api.searchComponents).toHaveBeenCalledWith(
      documentId,
      { q: "example", limit: 10 },
      expect.any(AbortSignal),
    );
    expect(api.listDependencyTreeChildren).toHaveBeenCalledWith(
      documentId,
      { parentComponentId: componentId, limit: 10 },
      expect.any(AbortSignal),
    );
  });

  it("polls an incomplete source-scoped quality report and pages its guidance", async () => {
    const quality = {
      report: {
        id: "77777777-7777-4777-8777-777777777777",
        sourceId: SOURCE_ID,
        releaseId: RELEASE_ID,
        documentId: "88888888-8888-4888-8888-888888888888",
        state: "queued",
        assessmentStatus: null,
        formulaVersion: "sbom-quality.v1",
        rulesetVersion: "bsi-tr-03183-2.v2.0.0",
        configurationVersion: 0,
        inputs: null,
        dimensions: [],
        totalScore: null,
        bsiProfile: null,
        baseline: null,
        regression: null,
        progress: { stage: "queued", percent: 0, message: "Queued" },
        error: null,
        completedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    } as const;
    api.getQualityReport.mockResolvedValue(quality);
    api.listQualityFindings.mockResolvedValue({
      findings: [],
      nextCursor: null,
    });

    const { result } = renderHook(
      () => ({
        quality: useSbomQualityReportQuery(SOURCE_ID, true),
        findings: useSbomQualityFindingsQuery(SOURCE_ID, { limit: 10 }, true),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.findings.isSuccess).toBe(true));
    expect(api.getQualityReport).toHaveBeenCalledWith(
      SOURCE_ID,
      expect.any(AbortSignal),
    );
    expect(api.listQualityFindings).toHaveBeenCalledWith(
      SOURCE_ID,
      { limit: 10 },
      expect.any(AbortSignal),
    );
  });

  it("looks up source-scoped diff state without invoking a write mutation", async () => {
    api.getSourceDiff.mockResolvedValue({
      status: "not_started",
      sourceId: SOURCE_ID,
      baselineSourceId: "77777777-7777-4777-8777-777777777777",
    });

    const { result } = renderHook(
      () =>
        useSbomSourceDiffQuery(
          SOURCE_ID,
          { baseSourceId: "77777777-7777-4777-8777-777777777777" },
          true,
        ),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ status: "not_started" });
    expect(api.getSourceDiff).toHaveBeenCalledWith(
      SOURCE_ID,
      { baseSourceId: "77777777-7777-4777-8777-777777777777" },
      expect.any(AbortSignal),
    );
  });

  it("caches the queued report returned by a retry mutation", async () => {
    const diff = {
      id: DIFF_ID,
      releaseId: RELEASE_ID,
      sourceId: SOURCE_ID,
      baselineSourceId: "77777777-7777-4777-8777-777777777777",
      documentId: "88888888-8888-4888-8888-888888888888",
      baselineDocumentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      state: "queued",
      comparisonStatus: "ready",
      comparatorVersion: "m4-unavailable.v1",
      counts: { componentChanges: 0 },
      findingDelta: {
        status: "partial_integration_unavailable",
        reason: "Finding delta requires the M4 advisory integration.",
        summary: null,
      },
      progress: {
        stage: "queued",
        percent: 0,
        message: "Waiting to compare the release lineage.",
      },
      error: null,
      completedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    } as const;
    api.retryDiff.mockResolvedValue({
      status: "queued",
      report: diff,
      replayed: false,
    });

    const { result } = renderHook(() => useRetrySbomDiffMutation(), {
      wrapper,
    });

    await result.current.mutateAsync({
      diffId: DIFF_ID,
      input: { idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    });

    expect(api.retryDiff).toHaveBeenCalledWith(DIFF_ID, {
      idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
  });
});
