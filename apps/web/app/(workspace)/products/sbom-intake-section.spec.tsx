// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { sbomUploadCompletionResponseSchema } from "@repo/contracts/sboms";

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../_lib/http/api-client";
import { SbomIntakeSection } from "./sbom-intake-section";

const queryHooks = vi.hoisted(() => ({
  useSbomJobQuery: vi.fn(),
  useSbomSourceHistoryQuery: vi.fn(),
  useSbomValidationReportQuery: vi.fn(),
  useSbomDocumentsForReleaseQuery: vi.fn(),
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
  queryHooks.useSbomDocumentsForReleaseQuery.mockReturnValue({
    data: { documents: [], nextCursor: null },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
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
  it("reuses the exact upload command after a lost initialization response", async () => {
    const user = userEvent.setup();
    vi.mocked(crypto.randomUUID)
      .mockReturnValueOnce("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
      .mockReturnValueOnce("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    sbomsApi.initializeUpload.mockRejectedValue(new Error("lost response"));
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
    await user.upload(
      screen.getByLabelText("SBOM file"),
      new File(["{}"], "original.json", { type: "application/json" }),
    );
    await user.click(screen.getByRole("button", { name: "Upload SBOM" }));
    await screen.findByText("The SBOM could not be uploaded.");
    await user.click(screen.getByRole("button", { name: "Upload SBOM" }));
    await waitFor(() =>
      expect(sbomsApi.initializeUpload).toHaveBeenCalledTimes(2),
    );
    expect(sbomsApi.initializeUpload.mock.calls[1]?.[0]).toEqual(
      sbomsApi.initializeUpload.mock.calls[0]?.[0],
    );
  });

  it.each(["queued", "replayed", "deduplicated"] as const)(
    "clears selected upload after the real %s completion envelope",
    async (outcome) => {
      const user = userEvent.setup();
      sbomsApi.initializeUpload.mockResolvedValue({
        source,
        upload: { uploadUrl: "https://storage.test/upload", expiresAt: NOW },
      });
      sbomsApi.uploadOriginal.mockResolvedValue(undefined);
      const response = sbomUploadCompletionResponseSchema.parse({
        job: completedJob,
        progressUrl: `/api/v1/sbom-jobs/${JOB_ID}`,
        completion: {
          outcome,
          sourceId: SOURCE_ID,
          canonicalSourceId: SOURCE_ID,
        },
      });
      sbomsApi.completeUpload.mockResolvedValue(response);
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
      await user.upload(
        screen.getByLabelText("SBOM file"),
        new File(["{}"], "original.json", { type: "application/json" }),
      );
      await user.click(screen.getByRole("button", { name: "Upload SBOM" }));
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Upload SBOM" }),
        ).toBeDisabled(),
      );
      expect(
        (screen.getByLabelText("SBOM file") as HTMLInputElement).value,
      ).toBe("");
      expect(
        (screen.getByLabelText("SBOM file") as HTMLInputElement).files,
      ).toHaveLength(0);
      expect(sbomsApi.completeUpload).toHaveBeenCalledOnce();
      expect(
        screen.queryByText("The SBOM could not be uploaded."),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Complete uploaded file" }),
      ).not.toBeInTheDocument();
    },
  );

  it("recovers a lost completion response using the same key and real replay metadata", async () => {
    const user = userEvent.setup();
    sbomsApi.initializeUpload.mockResolvedValue({
      source,
      upload: { uploadUrl: "https://storage.test/upload", expiresAt: NOW },
    });
    sbomsApi.uploadOriginal.mockResolvedValue(undefined);
    sbomsApi.completeUpload
      .mockRejectedValueOnce(new ApiClientError("network", "response lost"))
      .mockResolvedValueOnce(
        sbomUploadCompletionResponseSchema.parse({
          job: completedJob,
          progressUrl: `/api/v1/sbom-jobs/${JOB_ID}`,
          completion: {
            outcome: "replayed",
            sourceId: SOURCE_ID,
            canonicalSourceId: SOURCE_ID,
          },
        }),
      );
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
    const original = new File(["{}"], "original.json", {
      type: "application/json",
    });
    await user.upload(screen.getByLabelText("SBOM file"), original);
    await user.click(screen.getByRole("button", { name: "Upload SBOM" }));
    const retry = await screen.findByRole("button", {
      name: "Complete uploaded file",
    });
    expect(sbomsApi.completeUpload).toHaveBeenCalledOnce();
    expect(
      (screen.getByLabelText("SBOM file") as HTMLInputElement).files?.[0],
    ).toBe(original);
    await user.click(retry);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Upload SBOM" }),
      ).toBeDisabled(),
    );
    expect(sbomsApi.completeUpload.mock.calls[1]).toEqual(
      sbomsApi.completeUpload.mock.calls[0],
    );
    expect(sbomsApi.initializeUpload).toHaveBeenCalledOnce();
    expect(sbomsApi.uploadOriginal).toHaveBeenCalledOnce();
  });

  it("starts a fresh command when identical content is selected after confirmed completion", async () => {
    const user = userEvent.setup();
    vi.mocked(crypto.randomUUID)
      .mockReturnValueOnce("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
      .mockReturnValueOnce("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    sbomsApi.initializeUpload.mockResolvedValue({
      source,
      upload: { uploadUrl: "https://storage.test/upload", expiresAt: NOW },
    });
    sbomsApi.uploadOriginal.mockResolvedValue(undefined);
    sbomsApi.completeUpload.mockResolvedValue(
      sbomUploadCompletionResponseSchema.parse({
        job: completedJob,
        progressUrl: `/api/v1/sbom-jobs/${JOB_ID}`,
        completion: {
          outcome: "queued",
          sourceId: SOURCE_ID,
          canonicalSourceId: SOURCE_ID,
        },
      }),
    );
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
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await user.upload(
        screen.getByLabelText("SBOM file"),
        new File(["{}"], "original.json", {
          type: "application/json",
          lastModified: 1,
        }),
      );
      await user.click(screen.getByRole("button", { name: "Upload SBOM" }));
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Upload SBOM" }),
        ).toBeDisabled(),
      );
    }
    expect(sbomsApi.initializeUpload).toHaveBeenCalledTimes(2);
    const first = sbomsApi.initializeUpload.mock.calls[0]?.[0];
    const second = sbomsApi.initializeUpload.mock.calls[1]?.[0];
    expect(second).toEqual({
      ...first,
      idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    expect(first.idempotencyKey).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("reuses a terminal reservation without PUT and retries lost completion manually", async () => {
    const user = userEvent.setup();
    sbomsApi.initializeUpload.mockResolvedValue({
      source,
      upload: null,
      replayed: true,
    });
    sbomsApi.uploadOriginal.mockClear();
    sbomsApi.completeUpload
      .mockRejectedValueOnce(new ApiClientError("network", "response lost"))
      .mockResolvedValueOnce(
        sbomUploadCompletionResponseSchema.parse({
          job: completedJob,
          progressUrl: `/api/v1/sbom-jobs/${JOB_ID}`,
          completion: {
            outcome: "replayed",
            sourceId: SOURCE_ID,
            canonicalSourceId: SOURCE_ID,
          },
        }),
      );
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
    await user.upload(
      screen.getByLabelText("SBOM file"),
      new File(["{}"], "original.json", { type: "application/json" }),
    );
    await user.click(screen.getByRole("button", { name: "Upload SBOM" }));
    const retry = await screen.findByRole("button", {
      name: "Complete uploaded file",
    });
    expect(sbomsApi.completeUpload).toHaveBeenCalledOnce();
    expect(sbomsApi.uploadOriginal).not.toHaveBeenCalled();
    const initializedInput = sbomsApi.initializeUpload.mock.calls[0]?.[0];
    expect(sbomsApi.completeUpload).toHaveBeenCalledWith(SOURCE_ID, {
      idempotencyKey: initializedInput.idempotencyKey,
    });
    await user.click(retry);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Upload SBOM" }),
      ).toBeDisabled(),
    );
    expect(sbomsApi.completeUpload.mock.calls[1]).toEqual(
      sbomsApi.completeUpload.mock.calls[0],
    );
    expect(sbomsApi.initializeUpload).toHaveBeenCalledOnce();
    expect(sbomsApi.uploadOriginal).not.toHaveBeenCalled();
  });

  it("keeps completion recovery available when the storage response is lost", async () => {
    const user = userEvent.setup();
    sbomsApi.initializeUpload.mockResolvedValue({
      source,
      upload: { uploadUrl: "https://storage.test/upload", expiresAt: NOW },
    });
    sbomsApi.uploadOriginal.mockRejectedValue(
      new Error("lost storage response"),
    );
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
    await user.upload(
      screen.getByLabelText("SBOM file"),
      new File(["{}"], "original.json", { type: "application/json" }),
    );
    await user.click(screen.getByRole("button", { name: "Upload SBOM" }));
    expect(
      await screen.findByRole("button", { name: "Complete uploaded file" }),
    ).toBeEnabled();
    expect(sbomsApi.completeUpload).not.toHaveBeenCalled();
  });

  it("does not render repeatedly when an empty history response has a new reference", () => {
    let renders = 0;
    queryHooks.useSbomSourceHistoryQuery.mockImplementation(() => {
      renders += 1;
      if (renders > 8) throw new Error("Empty history caused a render loop");
      return {
        data: { sources: [], nextCursor: null },
        isPending: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      };
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

    expect(screen.getByLabelText("SBOM file")).toBeEnabled();
    expect(renders).toBeLessThanOrEqual(3);
  });

  it("offers bounded older-source pagination instead of hiding retained history", async () => {
    const user = userEvent.setup();
    queryHooks.useSbomSourceHistoryQuery.mockReturnValue({
      data: {
        sources: [
          {
            source,
            validation: {
              status: "pending",
              errorCount: 0,
              warningCount: 0,
              omittedDiagnosticCount: 0,
              completedAt: null,
            },
          },
        ],
        nextCursor: "older-page",
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
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
      screen.getByRole("button", { name: "Load older sources" }),
    );
    expect(queryHooks.useSbomSourceHistoryQuery).toHaveBeenLastCalledWith(
      PRODUCT_ID,
      RELEASE_ID,
      { limit: 10, cursor: "older-page" },
      true,
    );
  });

  it("retains the original and reservation after PUT fails before writing, then reuses the same command", async () => {
    const user = userEvent.setup();
    sbomsApi.initializeUpload.mockResolvedValue({
      source,
      upload: { uploadUrl: "https://storage.test/upload", expiresAt: NOW },
    });
    sbomsApi.uploadOriginal
      .mockRejectedValueOnce(new Error("storage offline"))
      .mockResolvedValueOnce(undefined);
    sbomsApi.completeUpload
      .mockRejectedValueOnce(new Error("source missing"))
      .mockResolvedValueOnce({ job: completedJob });
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
    const original = new File(["{}"], "original.json", {
      type: "application/json",
    });
    await user.upload(screen.getByLabelText("SBOM file"), original);
    await user.click(screen.getByRole("button", { name: "Upload SBOM" }));
    await user.click(
      await screen.findByRole("button", { name: "Complete uploaded file" }),
    );
    await screen.findByText("The SBOM could not be uploaded.");
    expect(
      (screen.getByLabelText("SBOM file") as HTMLInputElement).files?.[0],
    ).toBe(original);
    await user.click(screen.getByRole("button", { name: "Upload SBOM" }));
    await waitFor(() =>
      expect(sbomsApi.initializeUpload).toHaveBeenCalledTimes(2),
    );
    expect(sbomsApi.initializeUpload.mock.calls[1]?.[0]).toEqual(
      sbomsApi.initializeUpload.mock.calls[0]?.[0],
    );
    expect(sbomsApi.uploadOriginal.mock.calls[1]?.[1]).toBe(original);
  });

  it("rotates the command only when hashed upload metadata changes", async () => {
    const user = userEvent.setup();
    vi.mocked(crypto.randomUUID)
      .mockReturnValueOnce("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
      .mockReturnValueOnce("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    sbomsApi.initializeUpload.mockRejectedValue(new Error("lost response"));
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
    await user.upload(
      screen.getByLabelText("SBOM file"),
      new File(["{}"], "original.json", { type: "application/json" }),
    );
    await user.click(screen.getByRole("button", { name: "Upload SBOM" }));
    await screen.findByText("The SBOM could not be uploaded.");
    await user.upload(
      screen.getByLabelText("SBOM file"),
      new File(['{"changed":true}'], "changed.json", {
        type: "application/json",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Upload SBOM" }));
    await waitFor(() =>
      expect(sbomsApi.initializeUpload).toHaveBeenCalledTimes(2),
    );
    expect(
      sbomsApi.initializeUpload.mock.calls[1]?.[0].idempotencyKey,
    ).not.toEqual(sbomsApi.initializeUpload.mock.calls[0]?.[0].idempotencyKey);
  });

  it("starts a fresh command only after explicitly abandoning a failed or expired reservation", async () => {
    const user = userEvent.setup();
    vi.mocked(crypto.randomUUID)
      .mockReturnValueOnce("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
      .mockReturnValueOnce("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    sbomsApi.initializeUpload.mockRejectedValue(
      new Error("expired reservation"),
    );
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
    await user.upload(
      screen.getByLabelText("SBOM file"),
      new File(["{}"], "original.json", { type: "application/json" }),
    );
    await user.click(screen.getByRole("button", { name: "Upload SBOM" }));
    await user.click(
      await screen.findByRole("button", { name: "Start new upload attempt" }),
    );
    await user.click(screen.getByRole("button", { name: "Upload SBOM" }));
    await waitFor(() =>
      expect(sbomsApi.initializeUpload).toHaveBeenCalledTimes(2),
    );
    expect(
      sbomsApi.initializeUpload.mock.calls[1]?.[0].idempotencyKey,
    ).not.toEqual(sbomsApi.initializeUpload.mock.calls[0]?.[0].idempotencyKey);
  });

  it("keeps a newly reserved source selected while history has not caught up", async () => {
    const user = userEvent.setup();
    const newSourceId = "88888888-8888-4888-8888-888888888888";
    queryHooks.useSbomSourceHistoryQuery.mockReturnValue({
      data: {
        sources: [
          {
            source,
            validation: {
              status: "pending",
              errorCount: 0,
              warningCount: 0,
              omittedDiagnosticCount: 0,
              completedAt: null,
            },
          },
        ],
        nextCursor: null,
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    sbomsApi.initializeUpload.mockResolvedValue({
      source: { ...source, id: newSourceId },
      upload: { uploadUrl: "https://storage.test/upload", expiresAt: NOW },
    });
    sbomsApi.uploadOriginal.mockRejectedValue(
      new Error("lost storage response"),
    );
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
    await user.upload(
      screen.getByLabelText("SBOM file"),
      new File(["{}"], "new.json", { type: "application/json" }),
    );
    await user.click(screen.getByRole("button", { name: "Upload SBOM" }));
    await screen.findByText("The SBOM could not be uploaded.");
    expect(queryHooks.useSbomValidationReportQuery).toHaveBeenLastCalledWith(
      newSourceId,
      true,
    );
  });

  it("clears old upload identity, file input, and completion recovery when product scope changes", async () => {
    const user = userEvent.setup();
    sbomsApi.initializeUpload.mockResolvedValue({
      source,
      upload: { uploadUrl: "https://storage.test/upload", expiresAt: NOW },
    });
    sbomsApi.uploadOriginal.mockRejectedValue(new Error("storage offline"));
    const props = {
      productId: PRODUCT_ID,
      releases: RELEASES,
      canView: true,
      canUpload: true,
      canReplay: false,
      enabled: true,
    };
    const { rerender } = render(<SbomIntakeSection {...props} />);
    await user.upload(
      screen.getByLabelText("SBOM file"),
      new File(["{}"], "old.json", { type: "application/json" }),
    );
    await user.click(screen.getByRole("button", { name: "Upload SBOM" }));
    await screen.findByRole("button", { name: "Complete uploaded file" });
    rerender(
      <SbomIntakeSection
        {...props}
        productId="99999999-9999-4999-8999-999999999999"
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Complete uploaded file" }),
    ).not.toBeInTheDocument();
    expect(
      (screen.getByLabelText("SBOM file") as HTMLInputElement).files?.length,
    ).toBe(0);
    expect(screen.getByRole("button", { name: "Upload SBOM" })).toBeDisabled();
  });

  it("does not continue an old reservation after the active product changes", async () => {
    const user = userEvent.setup();
    let resolve!: (value: unknown) => void;
    sbomsApi.initializeUpload.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const props = {
      productId: PRODUCT_ID,
      releases: RELEASES,
      canView: true,
      canUpload: true,
      canReplay: false,
      enabled: true,
    };
    const { rerender } = render(<SbomIntakeSection {...props} />);
    await user.upload(
      screen.getByLabelText("SBOM file"),
      new File(["{}"], "old.json", { type: "application/json" }),
    );
    await user.click(screen.getByRole("button", { name: "Upload SBOM" }));
    await waitFor(() =>
      expect(sbomsApi.initializeUpload).toHaveBeenCalledOnce(),
    );
    rerender(
      <SbomIntakeSection
        {...props}
        productId="99999999-9999-4999-8999-999999999999"
      />,
    );
    await act(async () =>
      resolve({
        source,
        upload: { uploadUrl: "https://storage.test/upload", expiresAt: NOW },
      }),
    );
    expect(sbomsApi.uploadOriginal).not.toHaveBeenCalled();
    expect(sbomsApi.completeUpload).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Complete uploaded file" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    [403, "You no longer have permission to upload SBOM evidence."],
    [404, "That product release is unavailable."],
    [
      503,
      "The SBOM service is temporarily unavailable. Keep your selected file and retry the same upload or completion; previous evidence remains unchanged.",
    ],
  ])(
    "preserves input and explains upload authorization/provider status %s",
    async (status, message) => {
      const user = userEvent.setup();
      sbomsApi.initializeUpload.mockRejectedValue(
        new ApiClientError("api", "Rejected", Number(status)),
      );
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
      const original = new File(["{}"], "original.json", {
        type: "application/json",
      });
      await user.upload(screen.getByLabelText("SBOM file"), original);
      await user.click(screen.getByRole("button", { name: "Upload SBOM" }));
      expect(await screen.findByText(String(message))).toBeVisible();
      expect(
        (screen.getByLabelText("SBOM file") as HTMLInputElement).files?.[0],
      ).toBe(original);
      expect(sbomsApi.uploadOriginal).not.toHaveBeenCalled();
    },
  );
});
