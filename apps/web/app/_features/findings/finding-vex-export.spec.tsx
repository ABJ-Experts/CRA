// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../_lib/http/api-client";
import { FindingVexExport } from "./finding-vex-export";

const create = vi.fn();
const enqueue = vi.fn();
const retry = vi.fn();
const updateTarget = vi.fn();
const withdraw = vi.fn();

const at = "2026-09-08T12:00:00.000Z";
const productId = "11111111-1111-4111-8111-111111111111";
const releaseId = "22222222-2222-4222-8222-222222222222";
const exportId = "33333333-3333-4333-8333-333333333333";
const targetId = "44444444-4444-4444-8444-444444444444";
const publicationId = "55555555-5555-4555-8555-555555555555";

let publicationState: "dead_letter" | "published" = "dead_letter";

vi.mock("../../_providers/session-provider", () => ({
  useHasPermission: () => true,
}));
vi.mock("./triage.queries", () => ({
  useVulnerabilityVexExportPreviewQuery: () => ({
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    data: {
      organizationId: productId,
      productId,
      releaseId,
      scopeVersion: 3,
      scopeDigest: "b".repeat(64),
      eligibleAssessmentRevisions: [
        {
          findingId: publicationId,
          assessmentId: targetId,
          assessmentRevision: 2,
          status: "not_affected",
          justification: "component_not_present",
          approvalState: "approved",
        },
      ],
      formatAvailability: [
        {
          format: "openvex",
          specificationVersion: "0.2.0",
          supported: true,
          mappingIssues: [],
        },
        {
          format: "cyclonedx-vex",
          specificationVersion: "1.6",
          supported: false,
          mappingIssues: [
            {
              findingId: publicationId,
              assessmentId: targetId,
              code: "affected_not_supported",
              message: "Affected is not supported by this strict mapping.",
            },
          ],
        },
      ],
    },
  }),
  useVulnerabilityVexExportsQuery: () => ({
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    data: {
      exports: [
        {
          id: exportId,
          organizationId: productId,
          productId,
          releaseId,
          format: "openvex",
          specificationVersion: "0.2.0",
          scopeVersion: 3,
          scopeDigest: "b".repeat(64),
          contentSha256: "a".repeat(64),
          byteSize: 301,
          assessmentRevisionReferences: [
            {
              findingId: publicationId,
              assessmentId: targetId,
              assessmentRevision: 2,
              status: "not_affected",
              justification: "component_not_present",
              approvalState: "approved",
            },
          ],
          createdAt: at,
          createdByUserId: productId,
        },
      ],
    },
  }),
  useVulnerabilityVexPublicationTargetsQuery: () => ({
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    data: {
      targets: [
        {
          id: targetId,
          targetKey: "security-vex-publication",
          label: "Security VEX endpoint",
          kind: "https_put",
          enabled: true,
          version: 1,
          updatedAt: at,
          updatedByUserId: productId,
        },
      ],
    },
  }),
  useVulnerabilityVexPublicationsQuery: () => ({
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    data: {
      publications: [
        {
          id: publicationId,
          organizationId: productId,
          exportId,
          targetId,
          state: publicationState,
          attempts: 2,
          version: 1,
          lastErrorCode:
            publicationState === "dead_letter" ? "provider_unavailable" : null,
          lastErrorMessage:
            publicationState === "dead_letter"
              ? "The configured publication target is unavailable."
              : null,
          publishedAt: publicationState === "published" ? at : null,
          replacedByExportId: null,
          withdrawnAt: null,
          withdrawnReason: null,
          createdAt: at,
          updatedAt: at,
        },
      ],
    },
  }),
  useCreateVulnerabilityVexExportMutation: () => ({
    isPending: false,
    mutateAsync: create,
  }),
  useVulnerabilityVexExportDownloadMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useUpdateVulnerabilityVexPublicationTargetMutation: () => ({
    isPending: false,
    mutateAsync: updateTarget,
  }),
  useEnqueueVulnerabilityVexPublicationMutation: () => ({
    isPending: false,
    mutateAsync: enqueue,
  }),
  useRetryVulnerabilityVexPublicationMutation: () => ({
    isPending: false,
    mutateAsync: retry,
  }),
  useWithdrawVulnerabilityVexPublicationMutation: () => ({
    isPending: false,
    mutateAsync: withdraw,
  }),
}));

describe("FindingVexExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publicationState = "dead_letter";
    create.mockResolvedValue(undefined);
    enqueue.mockResolvedValue(undefined);
    retry.mockResolvedValue(undefined);
    updateTarget.mockResolvedValue(undefined);
    withdraw.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  function renderExport() {
    return render(
      <FindingVexExport
        productId={productId}
        productName="Sentinel"
        releaseId={releaseId}
        releaseName="1.4"
      />,
    );
  }

  it("shows exact scope and rejects a lossy CycloneDX mapping with text", () => {
    renderExport();
    expect(screen.getByText("Sentinel · 1.4")).toBeInTheDocument();
    expect(
      screen.getByText(/1 eligible approved revision/i),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Export format"), {
      target: { value: "cyclonedx-vex" },
    });
    expect(
      screen.getByText(/cannot represent this scope/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create validated export" }),
    ).toBeDisabled();
  });

  it("requires human confirmation before queuing an enabled publication target", async () => {
    renderExport();
    const publish = screen.getByRole("button", { name: "Queue publication" });
    expect(publish).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I confirm publication of SHA-256/i,
      }),
    );
    expect(publish).toBeEnabled();
    fireEvent.click(publish);
    await waitFor(() =>
      expect(enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          exportId,
          input: expect.objectContaining({ confirmTarget: true }),
        }),
      ),
    );
  });

  it("shows a delivery failure in text and permits an explicit retry", async () => {
    renderExport();
    expect(screen.getByText("Delivery failed")).toBeInTheDocument();
    expect(
      screen.getByText("The configured publication target is unavailable."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry publication" }));
    await waitFor(() => expect(retry).toHaveBeenCalledOnce());
  });

  it("preserves a withdrawal reason after an offline failure", async () => {
    publicationState = "published";
    withdraw.mockRejectedValueOnce(new ApiClientError("network", "", 0));
    renderExport();
    const reason = screen.getByLabelText("Withdrawal reason");
    fireEvent.change(reason, { target: { value: "Retire the endpoint." } });
    fireEvent.click(
      screen.getByRole("button", { name: "Withdraw publication" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/offline/i);
    expect(reason).toHaveValue("Retire the endpoint.");
  });
});
