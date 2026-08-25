// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SbomDiffReport } from "./sbom-diff-report";

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const BASELINE_SOURCE_ID = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_ID = "33333333-3333-4333-8333-333333333333";
const DIFF_ID = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-08-24T12:00:00.000Z";

const navigation = vi.hoisted(() => ({
  pathname:
    "/products/33333333-3333-4333-8333-333333333333/sboms/33333333-3333-4333-8333-333333333333/diff",
  params: new URLSearchParams(),
  replace: vi.fn(),
}));
const queries = vi.hoisted(() => ({
  useStartSbomDiffMutation: vi.fn(),
  useSbomDiffReportQuery: vi.fn(),
  useSbomDiffComponentsQuery: vi.fn(),
  useSbomDiffFindingsQuery: vi.fn(),
  useRetrySbomDiffMutation: vi.fn(),
  useSbomSourceDiffQuery: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => navigation.params,
}));
vi.mock("../../_features/sboms/sboms.queries", () => queries);

const completedReport = {
  id: DIFF_ID,
  releaseId: "55555555-5555-4555-8555-555555555555",
  sourceId: SOURCE_ID,
  baselineSourceId: BASELINE_SOURCE_ID,
  documentId: DOCUMENT_ID,
  baselineDocumentId: "66666666-6666-4666-8666-666666666666",
  state: "completed",
  comparisonStatus: "partial_integration_unavailable",
  comparatorVersion: "m4-comparator.unavailable",
  counts: { componentChanges: 2 },
  findingDelta: {
    status: "partial_integration_unavailable",
    reason: "M4 finding integration is not available.",
    summary: null,
  },
  progress: { stage: "completed", percent: 100, message: "Completed." },
  error: null,
  completedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
} as const;

function queryResult(overrides: Record<string, unknown> = {}) {
  return {
    isPending: false,
    isError: false,
    error: null,
    data: undefined,
    ...overrides,
  };
}

function mockCompleted() {
  queries.useSbomSourceDiffQuery.mockReturnValue(
    queryResult({ data: { status: "found", report: completedReport } }),
  );
  queries.useStartSbomDiffMutation.mockReturnValue({
    isPending: false,
    isError: false,
    error: null,
    data: { status: "queued", report: completedReport, replayed: false },
    mutate: vi.fn(),
    reset: vi.fn(),
  });
  queries.useSbomDiffReportQuery.mockReturnValue(
    queryResult({ data: { report: completedReport } }),
  );
  queries.useSbomDiffComponentsQuery.mockReturnValue(
    queryResult({
      data: {
        changes: [
          {
            id: "77777777-7777-4777-8777-777777777777",
            diffId: DIFF_ID,
            identity: "pkg:npm/example",
            ecosystem: "npm",
            change: "unresolved",
            currentComponentId: null,
            baselineComponentId: null,
            currentSourceOffset: 20,
            baselineSourceOffset: 10,
            currentPurl: "pkg:npm/example@2.0.0",
            baselinePurl: "pkg:npm/example@1.0.0",
            currentVersion: "2.0.0",
            baselineVersion: "1.0.0",
            explanation: "M4 version comparator is unavailable.",
            sourceOffset: 0,
            createdAt: NOW,
          },
        ],
        nextCursor: null,
      },
    }),
  );
  queries.useSbomDiffFindingsQuery.mockReturnValue(
    queryResult({
      data: {
        status: "partial_integration_unavailable",
        reason: "M4 finding integration is not available.",
        findings: [],
        nextCursor: null,
      },
    }),
  );
  queries.useRetrySbomDiffMutation.mockReturnValue({
    isPending: false,
    mutate: vi.fn(),
  });
}

describe("SbomDiffReport", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    navigation.params = new URLSearchParams();
  });

  function mockIdle() {
    queries.useStartSbomDiffMutation.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: undefined,
      mutate: vi.fn(),
      reset: vi.fn(),
    });
    queries.useSbomDiffReportQuery.mockReturnValue(queryResult());
    queries.useSbomDiffComponentsQuery.mockReturnValue(queryResult());
    queries.useSbomDiffFindingsQuery.mockReturnValue(queryResult());
    queries.useSbomSourceDiffQuery.mockReturnValue(queryResult());
    queries.useRetrySbomDiffMutation.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    });
  }

  it("keeps comparison access behind the existing SBOM read permission", () => {
    mockIdle();
    render(
      <SbomDiffReport
        productId={DOCUMENT_ID}
        documentId={DOCUMENT_ID}
        sourceId={SOURCE_ID}
        canView={false}
        canStart={false}
        enabled
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "do not have permission",
    );
    expect(queries.useStartSbomDiffMutation).toHaveBeenCalled();
  });

  it("explains a first source without inventing a comparable predecessor", async () => {
    const mutate = vi.fn();
    mockIdle();
    queries.useStartSbomDiffMutation.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: {
        status: "no_comparable_version",
        sourceId: SOURCE_ID,
        reason: "No prior complete source.",
      },
      mutate,
      reset: vi.fn(),
    });
    queries.useSbomSourceDiffQuery.mockReturnValue(
      queryResult({
        data: {
          status: "no_comparable_version",
          sourceId: SOURCE_ID,
          reason: "No prior complete source.",
        },
      }),
    );
    queries.useSbomDiffReportQuery.mockReturnValue(queryResult());
    queries.useRetrySbomDiffMutation.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    });

    render(
      <SbomDiffReport
        productId={DOCUMENT_ID}
        documentId={DOCUMENT_ID}
        sourceId={SOURCE_ID}
        canView
        canStart
        enabled
      />,
    );

    expect(
      await screen.findByText("No comparable version."),
    ).toBeInTheDocument();
    expect(screen.getByText("No prior complete source.")).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("renders unresolved components and a separate partial finding integration state", async () => {
    mockCompleted();
    render(
      <SbomDiffReport
        productId={DOCUMENT_ID}
        documentId={DOCUMENT_ID}
        sourceId={SOURCE_ID}
        canView
        canStart
        enabled
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Component changes" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Unresolved")).toBeInTheDocument();
    expect(
      screen.getByText("M4 version comparator is unavailable."),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("M4 finding integration is not available."),
    ).toHaveLength(2);
    fireEvent.change(
      screen.getByRole("textbox", { name: "Filter by ecosystem" }),
      { target: { value: "npm" } },
    );
    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
  });

  it("rejects an invalid baseline from the URL before starting a comparison", () => {
    const mutate = vi.fn();
    mockIdle();
    queries.useStartSbomDiffMutation.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: undefined,
      mutate,
      reset: vi.fn(),
    });
    navigation.params = new URLSearchParams({ baseSourceId: "not-a-uuid" });

    render(
      <SbomDiffReport
        productId={DOCUMENT_ID}
        documentId={DOCUMENT_ID}
        sourceId={SOURCE_ID}
        canView
        canStart
        enabled
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "baseline source identifier is invalid",
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it("names an identical graph without rendering redundant component filters", () => {
    mockCompleted();
    queries.useSbomDiffReportQuery.mockReturnValue(
      queryResult({
        data: {
          report: {
            ...completedReport,
            comparisonStatus: "identical",
            counts: { componentChanges: 0 },
          },
        },
      }),
    );

    render(
      <SbomDiffReport
        productId={DOCUMENT_ID}
        documentId={DOCUMENT_ID}
        sourceId={SOURCE_ID}
        canView
        canStart
        enabled
      />,
    );

    expect(screen.getByText("The compared normalized graphs are identical.")).toBeVisible();
    expect(screen.queryByRole("searchbox", { name: "Search component changes" })).not.toBeInTheDocument();
  });

  it("does not start a pending comparison for a viewer without upload permission", () => {
    const mutate = vi.fn();
    mockIdle();
    queries.useSbomSourceDiffQuery.mockReturnValue(
      queryResult({
        data: {
          status: "not_started",
          sourceId: SOURCE_ID,
          baselineSourceId: BASELINE_SOURCE_ID,
        },
      }),
    );
    queries.useStartSbomDiffMutation.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: undefined,
      mutate,
      reset: vi.fn(),
    });

    render(
      <SbomDiffReport
        productId={DOCUMENT_ID}
        documentId={DOCUMENT_ID}
        sourceId={SOURCE_ID}
        canView
        canStart={false}
        enabled
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "A comparison has not been generated.",
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it("starts only a comparable report that the source lookup marks not started", async () => {
    const mutate = vi.fn();
    mockIdle();
    queries.useSbomSourceDiffQuery.mockReturnValue(
      queryResult({
        data: {
          status: "not_started",
          sourceId: SOURCE_ID,
          baselineSourceId: BASELINE_SOURCE_ID,
        },
      }),
    );
    queries.useStartSbomDiffMutation.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: undefined,
      mutate,
      reset: vi.fn(),
    });

    render(
      <SbomDiffReport
        productId={DOCUMENT_ID}
        documentId={DOCUMENT_ID}
        sourceId={SOURCE_ID}
        canView
        canStart
        enabled
      />,
    );

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        sourceId: SOURCE_ID,
        input: expect.objectContaining({
          baseSourceId: BASELINE_SOURCE_ID,
        }),
      }),
    );
  });
});
