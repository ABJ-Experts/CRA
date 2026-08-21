// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  useSbomSourceHistoryQuery,
  useSbomValidationReportQuery,
} from "./sboms.queries";

const api = vi.hoisted(() => ({
  listSourcesForRelease: vi.fn(),
  getValidationReport: vi.fn(),
}));

vi.mock("./sboms.api", () => ({
  sbomsApi: api,
}));

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_ID = "33333333-3333-4333-8333-333333333333";
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
});
