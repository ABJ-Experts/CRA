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

import {
  ProductComplianceSections,
  productComplianceHeadingId,
  triggerEphemeralDownload,
} from "./product-compliance-sections";

const productId = "11111111-1111-4111-8111-111111111111";
const releaseId = "22222222-2222-4222-8222-222222222222";
const now = "2026-08-17T12:00:00.000Z";
const publish = vi.fn();
const saveDraft = vi.fn();
const reserve = vi.fn().mockResolvedValue({ upload: null });

vi.mock("../../_features/products/products.queries", () => ({
  useSubstantialModificationAssessmentsQuery: () => ({
    isPending: false,
    isError: false,
    data: {
      assessments: {
        rows: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            organizationId: "44444444-4444-4444-8444-444444444444",
            productId,
            modificationId: "33333333-3333-4333-8333-333333333333",
            supersedesId: null,
            modificationIdentifier: "SM-2026-001",
            title: "Trust boundary update",
            description: "Updates the authenticated relay service.",
            technicalScope: "Relay authentication and its deployment boundary.",
            introducedAt: now,
            detectedOrAssessedAt: now,
            previousState: "Relay used the previous trust boundary.",
            resultingState: "Relay uses the updated trust boundary.",
            requiredFollowUpActions: ["Review technical file impact."],
            completenessState: "complete",
            releaseIds: [releaseId],
            policyVersion: "m2.v2.substantial-modification.v1",
            answers: {
              changesIntendedPurpose: "no",
              changesSecurityArchitectureOrTrustBoundary: "yes",
              changesNetworkInterfaceOrPrivilegedRemoteControl: "no",
              changesCryptographyOrIdentityAccessControl: "no",
              changesSafetyOrSecurityRelevantComponent: "no",
            },
            rationale: "The update changes an authenticated trust boundary.",
            evidenceReferences: [],
            suggestion: "potentially_substantial",
            status: "submitted_for_review",
            determination: null,
            determinationRationale: null,
            overrideReason: null,
            reviewedAt: null,
            reviewedBy: null,
            version: 1,
            createdAt: now,
            createdBy: "55555555-5555-4555-8555-555555555555",
            updatedAt: now,
            updatedBy: "55555555-5555-4555-8555-555555555555",
          },
        ],
        total: 1,
        page: 1,
        pageSize: 15,
        pageCount: 1,
      },
    },
    refetch: vi.fn(),
  }),
  useSecurityUpdateArtifactsQuery: () => ({
    isPending: false,
    isError: false,
    data: {
      artifacts: {
        rows: [
          {
            id: "66666666-6666-4666-8666-666666666666",
            organizationId: "44444444-4444-4444-8444-444444444444",
            productId,
            releaseId,
            updateVersion: "1.0.1",
            title: "Sentinel security update 1.0.1",
            artifactType: "software_update",
            supportedPlatform: "Linux x86_64",
            signatureMetadata: null,
            fileName: "sentinel-1.0.1.tar.gz",
            contentType: "application/gzip",
            byteSize: 1024,
            sha256: "a".repeat(64),
            uploadStatus: "finalized",
            integrityStatus: "hash_mismatch",
            reviewStatus: "pending_review",
            publicationStatus: "draft",
            availabilityStatus: "blocked",
            statusExplanation: {
              code: "integrity_check_failed",
              message: "The verified hash differs from the reservation.",
            },
            issuedAt: now,
            supportPeriodId: null,
            supportPeriodRevision: null,
            supportEndsAt: null,
            availabilityRuleVersion: "m2.v2.security-update-availability.v1",
            issuedCandidate: "2036-08-17T12:00:00.000Z",
            supportCandidate: null,
            availabilityWinningRule: null,
            computedAvailabilityUntil: null,
            availabilityUntil: null,
            nonReductionApplied: false,
            distributionKind: "authenticated_download",
            distributionReference: null,
            publishedExternalReferences: [],
            replacementArtifactId: null,
            withdrawnAt: null,
            withdrawnReason: null,
            version: 1,
            createdAt: now,
            createdBy: "55555555-5555-4555-8555-555555555555",
            updatedAt: now,
            updatedBy: "55555555-5555-4555-8555-555555555555",
          },
        ],
        total: 1,
        page: 1,
        pageSize: 15,
        pageCount: 1,
      },
    },
    refetch: vi.fn(),
  }),
  useCreateSubstantialModificationAssessmentMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useCreateSubstantialModificationAssessmentDraftMutation: () => ({
    isPending: false,
    mutateAsync: saveDraft,
  }),
  useReassessSubstantialModificationAssessmentMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useReviewSubstantialModificationAssessmentMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useReserveSecurityUpdateArtifactMutation: () => ({
    isPending: false,
    mutateAsync: reserve,
  }),
  useFinalizeSecurityUpdateArtifactMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useFinalizeReservedSecurityUpdateArtifactMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useReviewSecurityUpdateArtifactMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  usePublishSecurityUpdateArtifactMutation: () => ({
    isPending: false,
    mutateAsync: publish,
  }),
  useReplaceSecurityUpdateArtifactMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useWithdrawSecurityUpdateArtifactMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));

describe("ProductComplianceSections", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });
  it("renders review-gated assessment history and the artifact integrity/availability state", () => {
    render(
      <ProductComplianceSections
        productId={productId}
        releases={[{ id: releaseId, label: "Sentinel 1.0", version: "1.0.0" }]}
        canEdit
        canApprove
        enabled
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Substantial modifications" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Review required")).toBeInTheDocument();
    expect(screen.getByText(/SM-2026-001/)).toBeInTheDocument();
    expect(
      screen.getByText("Review technical file impact."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Review assessment" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Security update artifacts" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Hash mismatch")).toBeInTheDocument();
    expect(
      screen.getAllByRole("alert").map((alert) => alert.textContent),
    ).toContain("Availability blocked");
    expect(
      screen.queryByRole("button", { name: "Clear quarantine" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Substantial modifications" }),
    ).toHaveAttribute(
      "id",
      productComplianceHeadingId("Substantial modifications"),
    );
  });

  it("submits an external-reference candidate at reservation time for server validation", async () => {
    render(
      <ProductComplianceSections
        productId={productId}
        releases={[{ id: releaseId, label: "Sentinel 1.0", version: "1.0.0" }]}
        canEdit
        canApprove
        enabled
      />,
    );
    fireEvent.change(screen.getByLabelText("Distribution"), {
      target: { value: "external_reference" },
    });
    fireEvent.change(screen.getByLabelText("External reference title"), {
      target: { value: "Published update" },
    });
    fireEvent.change(screen.getByLabelText("External reference HTTPS URI"), {
      target: { value: "https://updates.example.test/1.0.1" },
    });
    fireEvent.change(screen.getByLabelText("Expected byte size"), {
      target: { value: "1024" },
    });
    fireEvent.change(screen.getByLabelText("Update version"), {
      target: { value: "1.0.1" },
    });
    fireEvent.change(screen.getByLabelText("Artifact title"), {
      target: { value: "Published update" },
    });
    fireEvent.change(screen.getByLabelText("Supported platform"), {
      target: { value: "Linux x86_64" },
    });
    fireEvent.change(screen.getByLabelText("SHA-256"), {
      target: { value: "a".repeat(64) },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Reserve security update artifact" }),
    );
    await waitFor(() => expect(reserve).toHaveBeenCalledTimes(1));
    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        serverValidationRequired: true,
        externalReferenceCandidates: [
          expect.objectContaining({
            title: "Published update",
            uri: "https://updates.example.test/1.0.1",
          }),
        ],
      }),
    );
  });

  it("saves an accessible in-progress assessment draft through the typed mutation", async () => {
    render(
      <ProductComplianceSections
        productId={productId}
        releases={[{ id: releaseId, label: "Sentinel 1.0", version: "1.0.0" }]}
        canEdit
        canApprove={false}
        enabled
      />,
    );
    fireEvent.change(screen.getByLabelText("Modification identifier"), {
      target: { value: "SM-2026-002" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        completenessState: "in_progress",
        modificationIdentifier: "SM-2026-002",
      }),
    );
    await waitFor(() =>
      expect(screen.getByText("Assessment draft saved.")).toBeInTheDocument(),
    );
  });

  it("uses an ephemeral noreferrer anchor for signed downloads", () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const append = vi.spyOn(document.body, "append");
    triggerEphemeralDownload({
      downloadUrl: "https://storage.example.test/signed",
      fileName: "update.tar.gz",
    });
    const anchor = append.mock.calls[0]?.[0] as HTMLAnchorElement;
    expect(anchor).toMatchObject({
      download: "update.tar.gz",
      rel: "noreferrer",
    });
    expect(click).toHaveBeenCalled();
    expect(document.body.contains(anchor)).toBe(false);
  });
});
