// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProductComplianceSections,
  productComplianceHeadingId,
  triggerEphemeralDownload,
} from "./product-compliance-sections";
import { ApiClientError } from "../../_lib/http/api-client";

const productId = "11111111-1111-4111-8111-111111111111";
const releaseId = "22222222-2222-4222-8222-222222222222";
const assessmentId = "33333333-3333-4333-8333-333333333333";
const organizationId = "44444444-4444-4444-8444-444444444444";
const userId = "55555555-5555-4555-8555-555555555555";
const artifactId = "66666666-6666-4666-8666-666666666666";
const replacementArtifactId = "77777777-7777-4777-8777-777777777777";
const now = "2026-08-17T12:00:00.000Z";
const later = "2026-08-18T12:00:00.000Z";

const publish = vi.fn().mockResolvedValue(undefined);
const saveDraft = vi.fn();
const reserve = vi.fn().mockResolvedValue({ upload: null });
const reviewAssessment = vi.fn().mockResolvedValue(undefined);
const reassessAssessment = vi.fn().mockResolvedValue(undefined);
const reviewArtifact = vi.fn().mockResolvedValue(undefined);
const updateArtifactMetadata = vi.fn().mockResolvedValue(undefined);

function baseAssessment(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: assessmentId,
    organizationId,
    productId,
    modificationId: assessmentId,
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
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
    ...overrides,
  };
}

function baseArtifact(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: artifactId,
    organizationId,
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
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
    ...overrides,
  };
}

function pagedAssessments(rows: Record<string, unknown>[]) {
  return {
    assessments: {
      rows,
      total: rows.length,
      page: 1,
      pageSize: 15,
      pageCount: 1,
    },
  };
}
function pagedArtifacts(rows: Record<string, unknown>[]) {
  return {
    artifacts: { rows, total: rows.length, page: 1, pageSize: 15, pageCount: 1 },
  };
}

const assessmentsQueryResult = vi.fn();
const artifactsQueryResult = vi.fn();
const historyQueryResult = vi.fn();

function defaultAssessmentsResult() {
  return {
    isPending: false,
    isError: false,
    error: null,
    data: pagedAssessments([baseAssessment()]),
    refetch: vi.fn(),
  };
}
function defaultArtifactsResult() {
  return {
    isPending: false,
    isError: false,
    error: null,
    data: pagedArtifacts([baseArtifact()]),
    refetch: vi.fn(),
  };
}
function defaultHistoryResult() {
  return { isPending: false, isError: false, error: null, data: [] };
}

vi.mock("../../_features/products/products.queries", () => ({
  useSubstantialModificationAssessmentsQuery: () => assessmentsQueryResult(),
  useSecurityUpdateArtifactsQuery: () => artifactsQueryResult(),
  useSubstantialModificationAssessmentHistoryQuery: () => historyQueryResult(),
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
    mutateAsync: reassessAssessment,
  }),
  useReviewSubstantialModificationAssessmentMutation: () => ({
    isPending: false,
    mutateAsync: reviewAssessment,
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
    mutateAsync: reviewArtifact,
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
  useUpdateSecurityUpdateArtifactMetadataMutation: () => ({
    isPending: false,
    mutateAsync: updateArtifactMetadata,
  }),
}));

function renderSections(
  props: Partial<{
    canEdit: boolean;
    canApprove: boolean;
    releases: readonly { id: string; label: string; version: string }[];
  }> = {},
) {
  return render(
    <ProductComplianceSections
      productId={productId}
      releases={
        props.releases ?? [{ id: releaseId, label: "Sentinel 1.0", version: "1.0.0" }]
      }
      canEdit={props.canEdit ?? true}
      canApprove={props.canApprove ?? true}
      enabled
    />,
  );
}

describe("ProductComplianceSections", () => {
  beforeEach(() => {
    assessmentsQueryResult.mockReturnValue(defaultAssessmentsResult());
    artifactsQueryResult.mockReturnValue(defaultArtifactsResult());
    historyQueryResult.mockReturnValue(defaultHistoryResult());
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders review-gated assessment history and the artifact integrity/availability state", () => {
    renderSections();

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

  it("explains the availability calculation and hides lifecycle actions the state does not allow", () => {
    renderSections();

    expect(
      screen.getByText(
        "Issued candidate (issue date plus 10 calendar years)",
      ).nextElementSibling,
    ).toHaveTextContent("2036-08-17T12:00:00.000Z");
    expect(
      screen.getByText("Support period candidate").nextElementSibling,
    ).toHaveTextContent("Awaiting publication");
    expect(
      screen.getByText("Winning rule").nextElementSibling,
    ).toHaveTextContent("Awaiting publication");
    // A draft artifact that is already finalized cannot be finalized again,
    // and withdrawal or replacement require a published artifact.
    expect(
      screen.queryByRole("button", { name: "Finalize upload" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Withdraw artifact" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Replace artifact" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Publish artifact" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Previous artifacts" }),
    ).not.toBeInTheDocument();
  });

  it("submits an external-reference candidate at reservation time for server validation", async () => {
    renderSections();
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
    renderSections({ canApprove: false });
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

  it("adopts the first release once the releases query resolves after mount", () => {
    const view = renderSections({ releases: [] });

    // Before releases resolve the selects are empty rather than frozen: the
    // derived selection adopts the first release as soon as it arrives.
    view.rerender(
      <ProductComplianceSections
        productId={productId}
        releases={[{ id: releaseId, label: "Sentinel 1.0", version: "1.0.0" }]}
        canEdit
        canApprove
        enabled
      />,
    );
    expect(
      screen.getByRole("combobox", { name: "Affected release" }),
    ).toHaveValue(releaseId);
    expect(
      screen.getByRole("combobox", { name: "Release selector" }),
    ).toHaveValue(releaseId);
  });

  it("flags a potentially-substantial outcome but not a superseded revision of it", () => {
    assessmentsQueryResult.mockReturnValue({
      ...defaultAssessmentsResult(),
      data: pagedAssessments([
        baseAssessment(),
        baseAssessment({
          id: "88888888-8888-4888-8888-888888888888",
          status: "superseded",
          suggestion: "potentially_substantial",
        }),
      ]),
    });
    renderSections();
    expect(
      screen.getAllByText("Flagged for conformity follow-up"),
    ).toHaveLength(1);
  });

  it("does not flag a not-substantial outcome", () => {
    assessmentsQueryResult.mockReturnValue({
      ...defaultAssessmentsResult(),
      data: pagedAssessments([
        baseAssessment({ suggestion: "not_substantial" }),
      ]),
    });
    renderSections();
    expect(
      screen.queryByText("Flagged for conformity follow-up"),
    ).not.toBeInTheDocument();
  });

  it("shows the revision chain with the changed answer highlighted", () => {
    historyQueryResult.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: [
        baseAssessment({ version: 1, createdAt: now }),
        baseAssessment({
          id: "99999999-9999-4999-8999-999999999999",
          version: 2,
          createdAt: later,
          reviewedBy: userId,
          determination: "not_substantial",
          answers: {
            changesIntendedPurpose: "yes",
            changesSecurityArchitectureOrTrustBoundary: "yes",
            changesNetworkInterfaceOrPrivilegedRemoteControl: "no",
            changesCryptographyOrIdentityAccessControl: "no",
            changesSafetyOrSecurityRelevantComponent: "no",
          },
        }),
      ],
    });
    renderSections();
    fireEvent.click(screen.getByRole("button", { name: "View history" }));
    expect(screen.getByText(/Revision 1/)).toBeInTheDocument();
    expect(screen.getByText(/Revision 2/)).toBeInTheDocument();
    expect(screen.getByText(`Reviewed by ${userId}`)).toBeInTheDocument();
    const changedRows = screen.getAllByText("Changes intended purpose:");
    expect(changedRows).toHaveLength(2);
    expect(changedRows[0]?.closest("div")?.className).not.toContain(
      "bg-warning-surface",
    );
    expect(changedRows[1]?.closest("div")?.className).toContain(
      "bg-warning-surface",
    );
  });

  it("submits a rejection with its reason through the reject-quarantine action", async () => {
    renderSections();
    fireEvent.click(screen.getByRole("button", { name: "Reject artifact" }));
    fireEvent.change(screen.getByLabelText("Rejection reason"), {
      target: { value: "Hash verification failed." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm rejection" }));
    await waitFor(() => expect(reviewArtifact).toHaveBeenCalledTimes(1));
    expect(reviewArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "reject",
        reason: "Hash verification failed.",
        expectedVersion: 1,
      }),
    );
  });

  it("renders a link to a replacement artifact loaded on the same page", () => {
    artifactsQueryResult.mockReturnValue({
      ...defaultArtifactsResult(),
      data: pagedArtifacts([
        baseArtifact({
          publicationStatus: "replaced",
          replacementArtifactId,
        }),
        baseArtifact({ id: replacementArtifactId, title: "Sentinel 1.0.2" }),
      ]),
    });
    renderSections();
    expect(screen.getByText(/Replaced by artifact/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: replacementArtifactId });
    expect(link).toHaveAttribute("href", `#artifact-${replacementArtifactId}`);
  });

  it("gives each unhealthy integrity status its own distinct alert", () => {
    artifactsQueryResult.mockReturnValue({
      ...defaultArtifactsResult(),
      data: pagedArtifacts([
        baseArtifact({
          id: "aaaaaaaa-1111-4111-8111-111111111111",
          integrityStatus: "type_mismatch",
        }),
        baseArtifact({
          id: "aaaaaaaa-2222-4222-8222-222222222222",
          integrityStatus: "corrupt",
        }),
        baseArtifact({
          id: "aaaaaaaa-3333-4333-8333-333333333333",
          integrityStatus: "unavailable",
        }),
        baseArtifact({
          id: "aaaaaaaa-4444-4444-8444-444444444444",
          integrityStatus: "provider_unavailable",
        }),
      ]),
    });
    renderSections();
    expect(screen.getByText("Content type mismatch")).toBeInTheDocument();
    expect(screen.getByText("Artifact corrupt")).toBeInTheDocument();
    expect(screen.getByText("Artifact unavailable")).toBeInTheDocument();
    expect(screen.getByText("Storage provider unavailable")).toBeInTheDocument();
  });

  it("routes a 403 list error through the shared permission message", () => {
    assessmentsQueryResult.mockReturnValue({
      ...defaultAssessmentsResult(),
      isPending: false,
      isError: true,
      error: new ApiClientError("api", "Forbidden", 403, "forbidden"),
      data: undefined,
    });
    artifactsQueryResult.mockReturnValue({
      ...defaultArtifactsResult(),
      isPending: false,
      isError: true,
      error: new ApiClientError("api", "Forbidden", 403, "forbidden"),
      data: undefined,
    });
    renderSections();
    expect(
      screen.getAllByText(
        "You do not have permission to perform that action.",
      ),
    ).toHaveLength(2);
  });

  it("shows a reload prompt when an assessment review hits a version conflict", async () => {
    reviewAssessment.mockRejectedValueOnce(
      new ApiClientError("api", "Stale version", 409, "conflict"),
    );
    renderSections();
    fireEvent.change(screen.getByLabelText("Review rationale"), {
      target: { value: "Rationale for review." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review assessment" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Reload current data" }),
      ).toBeInTheDocument(),
    );
  });

  it("shows a reload prompt when a reassessment hits a version conflict", async () => {
    reassessAssessment.mockRejectedValueOnce(
      new ApiClientError("api", "Stale version", 409, "conflict"),
    );
    renderSections();
    fireEvent.click(
      screen.getByRole("button", { name: "Reassess assessment" }),
    );
    const submitButtons = screen.getAllByRole("button", {
      name: "Reassess assessment",
    });
    fireEvent.click(submitButtons[submitButtons.length - 1]!);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Reload current data" }),
      ).toBeInTheDocument(),
    );
  });

  it("shows a reload prompt when an artifact review hits a version conflict", async () => {
    artifactsQueryResult.mockReturnValue({
      ...defaultArtifactsResult(),
      data: pagedArtifacts([baseArtifact({ integrityStatus: "verified" })]),
    });
    reviewArtifact.mockRejectedValueOnce(
      new ApiClientError("api", "Stale version", 409, "conflict"),
    );
    renderSections();
    fireEvent.click(screen.getByRole("button", { name: "Clear quarantine" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Reload current data" }),
      ).toBeInTheDocument(),
    );
  });

  it("submits the metadata edit form and handles both success and a version conflict", async () => {
    renderSections();
    fireEvent.click(screen.getByRole("button", { name: "Edit metadata" }));
    fireEvent.change(screen.getByLabelText("Updated artifact title"), {
      target: { value: "Sentinel security update 1.0.1 (revised)" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save artifact metadata" }),
    );
    await waitFor(() => expect(updateArtifactMetadata).toHaveBeenCalledTimes(1));
    expect(updateArtifactMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 1,
        title: "Sentinel security update 1.0.1 (revised)",
        supportedPlatform: "Linux x86_64",
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByText("Artifact metadata updated."),
      ).toBeInTheDocument(),
    );

    updateArtifactMetadata.mockRejectedValueOnce(
      new ApiClientError("api", "Stale version", 409, "conflict"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save artifact metadata" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Reload current data" }),
      ).toBeInTheDocument(),
    );
  });
});
