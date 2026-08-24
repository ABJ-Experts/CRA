// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SbomNormalizedDocumentDetail } from "./sbom-normalized-document-detail";

const DOCUMENT_ID = "11111111-1111-4111-8111-111111111111";
const COMPONENT_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-08-24T12:00:00.000Z";

const state = vi.hoisted(() => ({
  detail: {
    isPending: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  search: { isPending: false, isError: false, error: null as unknown },
  tree: { isPending: false, isError: false, error: null as unknown },
  quality: {
    isPending: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  findings: { isPending: false, isError: false, error: null as unknown },
}));

const document = {
  id: DOCUMENT_ID,
  sourceId: "33333333-3333-4333-8333-333333333333",
  format: "cyclonedx",
  specificationVersion: "1.6",
  parser: { name: "CRA streaming parser", version: "1.0.0" },
  normalizer: { name: "CRA normalizer", version: "1.0.0" },
  state: "completed",
  validationStatus: "valid_with_warnings",
  componentCount: 2,
  dependencyCount: 1,
  maximumDepth: 1,
  warningCount: 1,
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
  sourceLocation: {
    path: "/components/0",
    byteStart: 0,
    byteEnd: 120,
    line: 1,
  },
} as const;

const queries = vi.hoisted(() => ({
  useSbomDocumentDetailQuery: vi.fn(),
  useSbomComponentSearchQuery: vi.fn(),
  useSbomDependencyTreeChildrenQueries: vi.fn(),
  useSbomQualityReportQuery: vi.fn(),
  useSbomQualityFindingsQuery: vi.fn(),
}));

vi.mock("../../_features/sboms/sboms.queries", () => queries);

function primeQueries() {
  queries.useSbomDocumentDetailQuery.mockReturnValue({
    ...state.detail,
    data: {
      document,
      diagnostics: [
        {
          severity: "warning",
          code: "invalid_purl",
          location: "/components/0/purl",
          message: "The supplied PURL was not valid.",
          sourceByteStart: 20,
          sourceByteEnd: 40,
        },
      ],
    },
  });
  queries.useSbomComponentSearchQuery.mockReturnValue({
    ...state.search,
    data: { components: [component], nextCursor: null },
  });
  queries.useSbomDependencyTreeChildrenQueries.mockReturnValue([
    {
      ...state.tree,
      data: { items: [{ component, childCount: 1 }], nextCursor: null },
    },
  ]);
  queries.useSbomQualityReportQuery.mockReturnValue({
    ...state.quality,
    data: {
      report: {
        id: "55555555-5555-4555-8555-555555555555",
        sourceId: document.sourceId,
        releaseId: "66666666-6666-4666-8666-666666666666",
        documentId: DOCUMENT_ID,
        state: "completed",
        assessmentStatus: "regression",
        formulaVersion: "sbom-quality.v1",
        rulesetVersion: "bsi-tr-03183-2.v2.0.0",
        configurationVersion: 1,
        inputs: {
          componentCount: 2,
          componentsWithCanonicalPurl: 1,
          componentsWithValidHash: 2,
          componentsWithSupplier: 0,
          componentsWithLicense: 1,
          primaryComponentIdentified: true,
          primaryComponentDirectDependencyCount: 1,
          maximumDepth: 1,
        },
        dimensions: [
          {
            id: "purl",
            eligibleCount: 2,
            satisfiedCount: 1,
            coveragePercent: 50,
            score: 50,
            weight: 20,
            weightedScore: 10,
            status: "partial",
          },
          {
            id: "top_level_dependency",
            eligibleCount: 1,
            satisfiedCount: 1,
            coveragePercent: 100,
            score: 100,
            weight: 20,
            weightedScore: 20,
            status: "complete",
          },
          {
            id: "transitive_depth",
            eligibleCount: 1,
            satisfiedCount: 1,
            coveragePercent: 100,
            score: 100,
            weight: 10,
            weightedScore: 10,
            status: "complete",
          },
        ],
        totalScore: 65,
        bsiProfile: {
          enabled: true,
          status: "warning",
          rulesetVersion: "bsi-tr-03183-2.v2.0.0",
          findingCount: 1,
        },
        baseline: {
          status: "available",
          reportId: "77777777-7777-4777-8777-777777777777",
          sourceId: "88888888-8888-4888-8888-888888888888",
          totalScore: 80,
          completedAt: NOW,
        },
        regression: {
          status: "regression",
          totalScoreDelta: -15,
          changedDimensions: ["purl"],
        },
        progress: {
          stage: "completed",
          percent: 100,
          message: "Quality report completed.",
        },
        error: null,
        completedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
  });
  queries.useSbomQualityFindingsQuery.mockReturnValue({
    ...state.findings,
    data: {
      findings: [
        {
          id: "99999999-9999-4999-8999-999999999999",
          reportId: "55555555-5555-4555-8555-555555555555",
          kind: "coverage_gap",
          severity: "warning",
          code: "missing_supplier",
          ruleId: null,
          dimension: "supplier",
          sourcePath: "/components/0/supplier",
          expected: "A supplier",
          actual: "Missing",
          remediation: "Add supplier evidence to the component.",
          componentId: COMPONENT_ID,
          createdAt: NOW,
        },
      ],
      nextCursor: null,
    },
  });
}

describe("SbomNormalizedDocumentDetail", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    state.detail.isPending = false;
    state.detail.isError = false;
  });

  it("renders completed metadata, normalized warnings, searchable components, and an accessible tree", () => {
    primeQueries();
    render(
      <SbomNormalizedDocumentDetail
        productId="44444444-4444-4444-8444-444444444444"
        documentId={DOCUMENT_ID}
        canView
        enabled
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Normalized SBOM" }),
    ).toBeVisible();
    expect(screen.getByText("CycloneDX 1.6")).toBeVisible();
    expect(screen.getByText("CRA streaming parser 1.0.0")).toBeVisible();
    expect(screen.getByText("invalid_purl")).toBeVisible();
    expect(screen.getByRole("tree", { name: "Dependency tree" })).toBeVisible();
    expect(screen.getByRole("treeitem", { name: /Example/i })).toHaveAttribute(
      "aria-level",
      "1",
    );
    expect(
      screen.getByRole("searchbox", { name: "Search components" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "SBOM quality report" }),
    ).toBeVisible();
    expect(screen.getByText("CRA legal floor")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Remediation guidance" }),
    ).toBeVisible();
  });

  it("expands a tree node with keyboard input and retains visible focus semantics", () => {
    primeQueries();
    render(
      <SbomNormalizedDocumentDetail
        productId="44444444-4444-4444-8444-444444444444"
        documentId={DOCUMENT_ID}
        canView
        enabled
      />,
    );

    const node = screen.getByRole("treeitem", { name: /Example/i });
    fireEvent.keyDown(node, { key: "ArrowRight" });
    expect(node).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps normalized records inaccessible to users without SBOM viewing permission", () => {
    primeQueries();
    render(
      <SbomNormalizedDocumentDetail
        productId="44444444-4444-4444-8444-444444444444"
        documentId={DOCUMENT_ID}
        canView={false}
        enabled
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "You do not have permission to view normalized SBOM data.",
    );
  });

  it("keeps a retryable failed normalization graph hidden while preserving its terminal explanation", () => {
    primeQueries();
    queries.useSbomDocumentDetailQuery.mockReturnValue({
      ...state.detail,
      data: {
        document: {
          ...document,
          state: "failed",
          error: {
            code: "component_limit_exceeded",
            message: "The component ceiling was exceeded.",
            retryable: true,
          },
        },
        diagnostics: [],
      },
    });
    render(
      <SbomNormalizedDocumentDetail
        productId="44444444-4444-4444-8444-444444444444"
        documentId={DOCUMENT_ID}
        canView
        enabled
      />,
    );

    expect(screen.getByText("Normalization is failed.")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Retryable: The component ceiling was exceeded.",
    );
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
  });

  it("keeps an in-progress quality calculation separate from the completed normalized graph", () => {
    primeQueries();
    queries.useSbomQualityReportQuery.mockReturnValue({
      ...state.quality,
      data: {
        report: {
          id: "55555555-5555-4555-8555-555555555555",
          sourceId: document.sourceId,
          releaseId: "66666666-6666-4666-8666-666666666666",
          documentId: DOCUMENT_ID,
          state: "processing",
          assessmentStatus: null,
          formulaVersion: "sbom-quality.v1",
          rulesetVersion: "bsi-tr-03183-2.v2.0.0",
          configurationVersion: 1,
          inputs: null,
          dimensions: [],
          totalScore: null,
          bsiProfile: null,
          baseline: null,
          regression: null,
          progress: {
            stage: "scoring",
            percent: 60,
            message: "Calculating explainable coverage.",
          },
          error: null,
          completedAt: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
    });
    render(
      <SbomNormalizedDocumentDetail
        productId="44444444-4444-4444-8444-444444444444"
        documentId={DOCUMENT_ID}
        canView
        enabled
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Quality report is processing.",
    );
    expect(screen.getByRole("tree", { name: "Dependency tree" })).toBeVisible();
  });

  it("offers a retry when normalized-document data is temporarily degraded", () => {
    primeQueries();
    queries.useSbomDocumentDetailQuery.mockReturnValue({
      ...state.detail,
      isError: true,
      error: new Error("offline"),
      data: undefined,
    });
    render(
      <SbomNormalizedDocumentDetail
        productId="44444444-4444-4444-8444-444444444444"
        documentId={DOCUMENT_ID}
        canView
        enabled
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Normalized SBOM data is temporarily unavailable.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(state.detail.refetch).toHaveBeenCalledTimes(1);
  });

  it("requests the next component page after an explicit load-more action", () => {
    primeQueries();
    queries.useSbomComponentSearchQuery.mockReturnValue({
      ...state.search,
      data: { components: [component], nextCursor: "components-next" },
    });
    render(
      <SbomNormalizedDocumentDetail
        productId="44444444-4444-4444-8444-444444444444"
        documentId={DOCUMENT_ID}
        canView
        enabled
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Load more components" }),
    );
    expect(queries.useSbomComponentSearchQuery).toHaveBeenLastCalledWith(
      DOCUMENT_ID,
      { limit: 25, cursor: "components-next" },
      true,
    );
  });

  it("scrolls virtualized tree navigation before moving focus beyond the rendered window", () => {
    primeQueries();
    const components = Array.from({ length: 20 }, (_, index) => ({
      ...component,
      id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
      originalName: `Example ${index + 1}`,
    }));
    queries.useSbomDependencyTreeChildrenQueries.mockReturnValue([
      {
        ...state.tree,
        data: {
          items: components.map((item) => ({ component: item, childCount: 0 })),
          nextCursor: null,
        },
      },
    ]);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    render(
      <SbomNormalizedDocumentDetail
        productId="44444444-4444-4444-8444-444444444444"
        documentId={DOCUMENT_ID}
        canView
        enabled
      />,
    );

    let active = screen.getByRole("treeitem", { name: "Example 1 1.0.0" });
    active.focus();
    for (let index = 0; index < 10; index += 1) {
      fireEvent.keyDown(active, { key: "ArrowDown" });
      active = globalThis.document.activeElement as HTMLButtonElement;
    }

    expect(screen.getByRole("tree")).toHaveProperty("scrollTop", 132);
    expect(active).toHaveAccessibleName("Example 11 1.0.0");
  });
});
