// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SbomIntakeSection } from "./sbom-intake-section";

const queryHooks = vi.hoisted(() => ({
  useSbomJobQuery: vi.fn(),
  useSbomSourceHistoryQuery: vi.fn(),
  useSbomValidationReportQuery: vi.fn(),
}));

const sbomsApi = vi.hoisted(() => ({
  initializeUpload: vi.fn(),
  completeUpload: vi.fn(),
  uploadOriginal: vi.fn(),
  downloadOriginal: vi.fn(),
  replayJob: vi.fn(),
}));

vi.mock("../../_features/sboms/sboms.queries", () => queryHooks);
vi.mock("../../_features/sboms/sboms.api", () => ({ sbomsApi }));

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_ID = "33333333-3333-4333-8333-333333333333";
const JOB_ID = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-08-21T04:00:00.000Z";
const HASH = "a".repeat(64);
const RELEASES = Object.freeze([
  { id: RELEASE_ID, label: "Sentinel 1.0", version: "1.0.0" },
]);

const source = {
  id: SOURCE_ID,
  organizationId: "55555555-5555-4555-8555-555555555555",
  productId: PRODUCT_ID,
  releaseId: RELEASE_ID,
  source: "manual_upload",
  fileName: "sentinel.cdx.json",
  mediaType: "application/vnd.cyclonedx+json",
  byteSize: 1024,
  sha256: HASH,
  status: "verified",
  declaredFormat: "cyclonedx",
  declaredSpecVersion: "1.6",
  createdAt: NOW,
  completedAt: NOW,
} as const;

const completedJob = {
  id: JOB_ID,
  organizationId: source.organizationId,
  sourceId: SOURCE_ID,
  releaseId: RELEASE_ID,
  inputSha256: HASH,
  correlationId: "66666666-6666-4666-8666-666666666666",
  status: "completed",
  progress: {
    stage: "completed",
    percent: 100,
    message: "Original evidence captured",
  },
  attempts: 1,
  maxAttempts: 5,
  error: null,
  result: {
    outcome: "original_evidence_captured",
    sourceId: SOURCE_ID,
    sha256: HASH,
  },
  createdAt: NOW,
  updatedAt: NOW,
  completedAt: NOW,
} as const;

const warningReport = {
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
    completedAt: NOW,
  },
} as const;

const invalidReport = {
  source,
  report: {
    ...warningReport.report,
    status: "invalid",
    diagnostics: [
      {
        severity: "error",
        code: "invalid-schema",
        location: "$.bomFormat",
        message: "The document does not match the declared SBOM schema.",
        remediation: "Upload a corrected SBOM that matches the detected spec.",
      },
    ],
    errorCount: 1,
    warningCount: 0,
  },
} as const;

function useDefaultQueries() {
  queryHooks.useSbomJobQuery.mockReturnValue({
    data: undefined,
    isPending: false,
    isError: false,
  });
  queryHooks.useSbomSourceHistoryQuery.mockReturnValue({
    data: { sources: [], nextCursor: null },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  queryHooks.useSbomValidationReportQuery.mockReturnValue({
    data: undefined,
    isPending: false,
    isError: false,
    error: null,
  });
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  window.dispatchEvent(new Event("resize"));
}

function ancestorWithClass(element: HTMLElement, classToken: string) {
  let current: HTMLElement | null = element;
  while (current) {
    if (current.classList.contains(classToken)) return current;
    current = current.parentElement;
  }
  throw new Error(`Missing ancestor with class ${classToken}`);
}

function expectMobileContainer(element: HTMLElement | null, label: string) {
  expect(element, label).not.toBeNull();
  const className = element?.getAttribute("class") ?? "";
  expect(className, label).toEqual(expect.stringContaining("min-w-0"));
  expect(className, label).toEqual(expect.stringContaining("max-w-full"));
}

describe("SbomIntakeSection", () => {
  beforeEach(() => {
    useDefaultQueries();
    const cryptoMock = {
      randomUUID: vi.fn(() => "77777777-7777-4777-8777-777777777777"),
      subtle: {
        digest: vi.fn(async () => new Uint8Array(32).fill(171).buffer),
      },
    };
    vi.stubGlobal("crypto", cryptoMock);
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: cryptoMock,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("explains the release requirement without offering storage access when no release exists", () => {
    render(
      <SbomIntakeSection
        productId={PRODUCT_ID}
        releases={[]}
        canView
        canUpload
        canReplay={false}
        enabled
      />,
    );

    expect(
      screen.getByRole("heading", { name: "SBOM evidence" }),
    ).toBeVisible();
    expect(screen.getByText(/Create a product release/i)).toBeVisible();
    expect(screen.queryByLabelText("SBOM file")).not.toBeInTheDocument();
  });

  it("keeps the evidence status readable while upload authority is absent", () => {
    render(
      <SbomIntakeSection
        productId={PRODUCT_ID}
        releases={RELEASES}
        canView
        canUpload={false}
        canReplay={false}
        enabled
      />,
    );

    expect(screen.getByText(/view SBOM evidence/i)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Upload SBOM" }),
    ).not.toBeInTheDocument();
  });

  it("provides a labeled, constrained upload control for an authorized release", () => {
    render(
      <SbomIntakeSection
        productId={PRODUCT_ID}
        releases={RELEASES}
        canView
        canUpload
        canReplay={false}
        enabled
      />,
    );

    expect(screen.getByLabelText("Release")).toHaveTextContent("Sentinel 1.0");
    expect(screen.getByLabelText("SBOM file")).toHaveAttribute(
      "accept",
      expect.stringContaining("application/vnd.cyclonedx+json"),
    );
    expect(screen.getByRole("button", { name: "Upload SBOM" })).toBeDisabled();
  });

  it("renders the server-backed validation report with accessible diagnostics and actions", () => {
    queryHooks.useSbomSourceHistoryQuery.mockReturnValue({
      data: {
        sources: [
          {
            source,
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
      },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    queryHooks.useSbomValidationReportQuery.mockReturnValue({
      data: warningReport,
      isPending: false,
      isError: false,
      error: null,
    });

    render(
      <SbomIntakeSection
        productId={PRODUCT_ID}
        releases={RELEASES}
        canView
        canUpload
        canReplay={false}
        enabled
      />,
    );

    expect(screen.getByText(/CycloneDX 1.6/i)).toBeVisible();
    expect(screen.getByText(HASH.slice(0, 12), { exact: false })).toBeVisible();
    expect(screen.getByRole("button", { name: /Warnings 1/i })).toBeVisible();
    expect(
      screen.getByRole("table", { name: /SBOM diagnostics/i }),
    ).toBeVisible();
    expect(screen.getByText("missing-license")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Upload corrected version" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Download original" }),
    ).toBeVisible();
  });

  it("contains non-table panels at a 390px mobile viewport while keeping diagnostic table scroll local", () => {
    setViewportWidth(390);
    const longRelease = {
      id: RELEASE_ID,
      label: "SBOM validation 1787302246456-0-0",
      version: "1.0.1787302246456-0-0",
    };
    const longSource = {
      ...source,
      fileName: "e2e-corrected-1787302246456-0-0.cdx.json",
    };
    const longReport = {
      source: longSource,
      report: warningReport.report,
    };
    queryHooks.useSbomSourceHistoryQuery.mockReturnValue({
      data: {
        sources: [
          {
            source: longSource,
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
      },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    queryHooks.useSbomValidationReportQuery.mockReturnValue({
      data: longReport,
      isPending: false,
      isError: false,
      error: null,
    });

    render(
      <SbomIntakeSection
        productId={PRODUCT_ID}
        releases={[longRelease]}
        canView
        canUpload
        canReplay={false}
        enabled
      />,
    );

    expectMobileContainer(
      screen.getByRole("heading", { name: "SBOM evidence" }).closest("section"),
      "SBOM evidence section",
    );
    expectMobileContainer(
      screen.getByLabelText("Release").closest("div"),
      "release select control",
    );
    expectMobileContainer(
      screen.getByLabelText("SBOM file").closest("label"),
      "file upload control",
    );
    expectMobileContainer(screen.getByLabelText("SBOM file"), "file input");
    expectMobileContainer(
      ancestorWithClass(
        screen.getByText("Source history"),
        "bg-surface-subtle",
      ),
      "source history panel",
    );
    expectMobileContainer(
      ancestorWithClass(
        screen.getByText("Validation report"),
        "bg-surface-subtle",
      ),
      "validation report panel",
    );

    const diagnosticsTable = screen.getByRole("table", {
      name: /SBOM diagnostics/i,
    });
    expect(diagnosticsTable).toHaveClass("min-w-[44rem]");
    expect(diagnosticsTable.closest("div")).toHaveClass(
      "max-w-full",
      "overflow-x-auto",
    );
  });

  it("reports processing diagnostics instead of an empty filter when summary counts exist before details load", () => {
    queryHooks.useSbomSourceHistoryQuery.mockReturnValue({
      data: {
        sources: [
          {
            source,
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
      },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    queryHooks.useSbomValidationReportQuery.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      error: null,
    });

    render(
      <SbomIntakeSection
        productId={PRODUCT_ID}
        releases={RELEASES}
        canView
        canUpload
        canReplay={false}
        enabled
      />,
    );

    expect(screen.getByRole("button", { name: /Warnings 1/i })).toBeVisible();
    expect(
      screen.getByText(/Diagnostic details are still processing/i),
    ).toBeVisible();
    expect(
      screen.queryByText("No diagnostics match this filter."),
    ).not.toBeInTheDocument();
  });

  it("reports unavailable diagnostics instead of an empty filter when summary counts exist during report degradation", () => {
    queryHooks.useSbomSourceHistoryQuery.mockReturnValue({
      data: {
        sources: [
          {
            source,
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
      },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    queryHooks.useSbomValidationReportQuery.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("Validation report failed"),
    });

    render(
      <SbomIntakeSection
        productId={PRODUCT_ID}
        releases={RELEASES}
        canView
        canUpload
        canReplay={false}
        enabled
      />,
    );

    expect(screen.getByRole("button", { name: /Warnings 1/i })).toBeVisible();
    expect(
      screen.getByText(/Diagnostic details are unavailable/i),
    ).toBeVisible();
    expect(
      screen.queryByText("No diagnostics match this filter."),
    ).not.toBeInTheDocument();
  });

  it("uploads a corrected unknown-type file as a fresh octet-stream source linked to the old source", async () => {
    const user = userEvent.setup({ applyAccept: false });
    queryHooks.useSbomSourceHistoryQuery.mockReturnValue({
      data: {
        sources: [
          {
            source,
            validation: {
              status: "invalid",
              errorCount: 1,
              warningCount: 0,
              omittedDiagnosticCount: 0,
              completedAt: NOW,
            },
          },
        ],
        nextCursor: null,
      },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    queryHooks.useSbomValidationReportQuery.mockReturnValue({
      data: invalidReport,
      isPending: false,
      isError: false,
      error: null,
    });
    sbomsApi.initializeUpload.mockResolvedValue({
      source: { ...source, id: "88888888-8888-4888-8888-888888888888" },
      upload: { uploadUrl: "https://storage.test/upload", expiresAt: NOW },
    });
    sbomsApi.uploadOriginal.mockResolvedValue(undefined);
    sbomsApi.completeUpload.mockResolvedValue({
      job: completedJob,
      progressUrl: `/api/v1/sbom-jobs/${JOB_ID}`,
    });

    render(
      <SbomIntakeSection
        productId={PRODUCT_ID}
        releases={RELEASES}
        canView
        canUpload
        canReplay={false}
        enabled
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Upload corrected version" }),
    );
    await user.upload(
      screen.getByLabelText("SBOM file"),
      new File(["{}"], "corrected.sbom", { type: "" }),
    );
    expect(
      screen.queryByText(/Choose a JSON, XML, or supported SBOM media type/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Upload corrected SBOM" }),
    ).toBeEnabled();
    await user.click(
      screen.getByRole("button", { name: "Upload corrected SBOM" }),
    );

    await waitFor(() =>
      expect(sbomsApi.initializeUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaType: "application/octet-stream",
          supersedesSourceId: SOURCE_ID,
        }),
      ),
    );
  });
});
