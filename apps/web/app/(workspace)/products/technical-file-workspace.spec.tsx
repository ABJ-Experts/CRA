// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../_lib/http/api-client";
import { TechnicalFileWorkspace } from "./technical-file-workspace";

const query = vi.hoisted(() => ({
  useTechnicalFileQuery: vi.fn(),
  useCreateTechnicalFileMutation: vi.fn(),
  useUpdateTechnicalFileSectionMutation: vi.fn(),
  useAddTechnicalFileSourceMutation: vi.fn(),
  useRemoveTechnicalFileSourceMutation: vi.fn(),
  useTechnicalFileReadinessQuery: vi.fn(),
  useRecalculateTechnicalFileReadinessMutation: vi.fn(),
  useReviewTechnicalFileSourceMutation: vi.fn(),
  useSignalTechnicalFileSourceMaterialChangeMutation: vi.fn(),
}));
const session = vi.hoisted(() => ({
  useSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../../_providers/providers", () => ({ useMocksReady: () => true }));
vi.mock("../../_providers/session-provider", () => session);
vi.mock("../../_features/technical-files/technical-files.queries", () => query);
vi.mock("../../_features/risk-register/risk-register-workspace", () => ({
  RiskRegisterWorkspace: () => <div>Risk register</div>,
}));
vi.mock("../../_features/technical-files/technical-file-snapshots", () => ({
  TechnicalFileSnapshots: () => <div>Technical-file snapshots</div>,
}));
vi.mock("../../_features/technical-files/technical-file-declarations", () => ({
  TechnicalFileDeclarations: () => <div>EU declarations of conformity</div>,
}));

const section = {
  id: "11111111-1111-4111-8111-111111111111",
  key: "general_description",
  heading: "General description",
  requirementText: "Describe the product.",
  sortOrder: 1,
  narrative: null,
  applicability: "applicable",
  nonApplicabilityReason: null,
  version: 1,
  status: "incomplete",
  sources: [],
  updatedAt: "2026-09-14T00:00:00.000Z",
} as const;

function prime(
  options: { readonly canEdit?: boolean; readonly data?: unknown } = {},
) {
  session.useSession.mockReturnValue({
    session: {
      organizations: [{ id: "00000000-0000-4000-8000-000000000001" }],
    },
    permissions: {
      can_view_technical_files: true,
      can_edit_technical_files: options.canEdit ?? true,
    },
    isLoading: false,
  });
  query.useTechnicalFileQuery.mockReturnValue({
    isPending: false,
    isError: false,
    data: options.data,
    refetch: vi.fn(),
  });
  query.useCreateTechnicalFileMutation.mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn(),
  });
  query.useUpdateTechnicalFileSectionMutation.mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn(),
  });
  query.useAddTechnicalFileSourceMutation.mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn(),
  });
  query.useRemoveTechnicalFileSourceMutation.mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn(),
  });
  query.useTechnicalFileReadinessQuery.mockReturnValue({
    isPending: false,
    isError: false,
    data: {
      readiness: {
        technicalFileId: "22222222-2222-4222-8222-222222222222",
        overallStatus: "partial",
        recalculationStatus: "current",
        calculatedAt: "2026-09-14T00:00:00.000Z",
        sections: [
          {
            sectionKey: "general_description",
            status: "partial",
            gapCount: 1,
            validEvidenceCount: 0,
            staleEvidenceCount: 0,
            unavailableEvidenceCount: 0,
            staleReasons: [],
            gaps: [
              {
                sectionKey: "general_description",
                code: "missing_evidence",
                priority: 1,
                actionLabel: "Link product evidence",
              },
            ],
          },
        ],
        gaps: [
          {
            sectionKey: "general_description",
            code: "missing_evidence",
            priority: 1,
            actionLabel: "Link product evidence",
          },
        ],
      },
    },
    refetch: vi.fn(),
  });
  query.useRecalculateTechnicalFileReadinessMutation.mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn(),
  });
  query.useReviewTechnicalFileSourceMutation.mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn(),
  });
  query.useSignalTechnicalFileSourceMaterialChangeMutation.mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn(),
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "false");
});

describe("TechnicalFileWorkspace", () => {
  it("shows the explicit V1 attachment boundary and opens a source-linked section", () => {
    prime({
      data: {
        technicalFile: {
          id: "22222222-2222-4222-8222-222222222222",
          organizationId: "00000000-0000-4000-8000-000000000001",
          productId: "33333333-3333-4333-8333-333333333333",
          templateKey: "annex_vii",
          templateVersion: "2024-01",
          legalSource: "Regulation (EU) 2024/2847, Annex VII",
          status: "active",
          version: 1,
          sections: [section],
          createdAt: "2026-09-14T00:00:00.000Z",
          updatedAt: "2026-09-14T00:00:00.000Z",
        },
        retention: {
          ruleVersion: "m2.v1.later_of_placement_plus_10y_or_support_end",
          status: "incomplete",
          placedOnMarketCandidate: null,
          supportPeriodCandidate: null,
          retentionUntil: null,
          retentionProtectionUntil: null,
          winningRule: null,
          incompleteReasons: ["missing_placed_on_market_at"],
          legalHoldActive: false,
          releaseCalculations: [],
        },
      },
    });

    render(
      <TechnicalFileWorkspace productId="33333333-3333-4333-8333-333333333333" />,
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: "Open section" }).at(-1)!,
    );

    expect(screen.getByText("Annex VII requirement")).toBeInTheDocument();
    expect(
      screen.getByText(/Document attachments are unavailable in M7-01/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Link source" }),
    ).toBeInTheDocument();
  });

  it("does not offer creation to a view-only user", () => {
    prime({ canEdit: false });
    query.useTechnicalFileQuery.mockReturnValue({
      isPending: false,
      isError: true,
      error: new ApiClientError("api", "Not found", 404),
      refetch: vi.fn(),
    });

    render(
      <TechnicalFileWorkspace productId="33333333-3333-4333-8333-333333333333" />,
    );

    expect(
      screen.queryByRole("button", { name: "Create technical file" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/cannot create or edit/i)).toBeInTheDocument();
  });

  it("shows documentation readiness and prioritised actions without claiming certification", () => {
    prime({
      data: {
        technicalFile: {
          id: "22222222-2222-4222-8222-222222222222",
          organizationId: "00000000-0000-4000-8000-000000000001",
          productId: "33333333-3333-4333-8333-333333333333",
          templateKey: "annex_vii",
          templateVersion: "2024-01",
          legalSource: "Regulation (EU) 2024/2847, Annex VII",
          status: "active",
          version: 1,
          sections: [section],
          createdAt: "2026-09-14T00:00:00.000Z",
          updatedAt: "2026-09-14T00:00:00.000Z",
        },
        retention: {
          ruleVersion: "m2.v1.later_of_placement_plus_10y_or_support_end",
          status: "incomplete",
          placedOnMarketCandidate: null,
          supportPeriodCandidate: null,
          retentionUntil: null,
          retentionProtectionUntil: null,
          winningRule: null,
          incompleteReasons: [],
          legalHoldActive: false,
          releaseCalculations: [],
        },
      },
    });

    render(
      <TechnicalFileWorkspace productId="33333333-3333-4333-8333-333333333333" />,
    );

    expect(screen.getByText("Documentation readiness")).toBeInTheDocument();
    expect(screen.getByText("partial")).toBeInTheDocument();
    expect(screen.getByText("Link product evidence")).toBeInTheDocument();
    expect(
      screen.getAllByText(/does not certify legal completeness/i).length,
    ).toBeGreaterThan(0);
  });

  it("preserves a stale-evidence review rationale when local validation fails", () => {
    prime({
      data: {
        technicalFile: {
          id: "22222222-2222-4222-8222-222222222222",
          organizationId: "00000000-0000-4000-8000-000000000001",
          productId: "33333333-3333-4333-8333-333333333333",
          templateKey: "annex_vii",
          templateVersion: "2024-01",
          legalSource: "Regulation (EU) 2024/2847, Annex VII",
          status: "active",
          version: 1,
          sections: [
            {
              ...section,
              sources: [
                {
                  id: "44444444-4444-4444-8444-444444444444",
                  kind: "manual_reference",
                  recordId: null,
                  observedRevision: "2024 edition",
                  title: "Applicable standard",
                  editionOrRevision: "2024 edition",
                  issuer: null,
                  locator: null,
                  rationale: null,
                  status: "stale",
                  linkVersion: 1,
                  sourceFingerprint: "edition-2024",
                  staleAt: "2026-09-14T00:00:00.000Z",
                  staleReason: "standard_edition_changed",
                  currentObservedRevision: "2025 edition",
                  currentFingerprint: "edition-2025",
                  reviewedAt: "2026-09-14T00:00:00.000Z",
                  reviews: [
                    {
                      id: "55555555-5555-4555-8555-555555555555",
                      sourceId: "44444444-4444-4444-8444-444444444444",
                      decision: "retain",
                      rationale: "Prior edition remains applicable.",
                      previousObservedRevision: "2024 edition",
                      previousFingerprint: "edition-2024",
                      reviewedObservedRevision: "2025 edition",
                      reviewedFingerprint: "edition-2025",
                      reviewedByUserId: "00000000-0000-4000-8000-000000000001",
                      createdAt: "2026-09-14T00:00:00.000Z",
                    },
                  ],
                  createdAt: "2026-09-14T00:00:00.000Z",
                },
              ],
            },
          ],
          createdAt: "2026-09-14T00:00:00.000Z",
          updatedAt: "2026-09-14T00:00:00.000Z",
        },
        retention: {
          ruleVersion: "m2.v1.later_of_placement_plus_10y_or_support_end",
          status: "incomplete",
          placedOnMarketCandidate: null,
          supportPeriodCandidate: null,
          retentionUntil: null,
          retentionProtectionUntil: null,
          winningRule: null,
          incompleteReasons: [],
          legalHoldActive: false,
          releaseCalculations: [],
        },
      },
    });

    render(
      <TechnicalFileWorkspace productId="33333333-3333-4333-8333-333333333333" />,
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: "Open section" })[0]!,
    );
    expect(
      screen.getByText(/Changed: standard edition changed/),
    ).toBeInTheDocument();
    expect(screen.getByText("Review history")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Review stale evidence" }),
    );
    const rationale = screen.getByLabelText("Review rationale");
    fireEvent.change(rationale, {
      target: { value: "Awaiting signed update." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));

    expect(rationale).toHaveValue("Awaiting signed update.");
  });
});
