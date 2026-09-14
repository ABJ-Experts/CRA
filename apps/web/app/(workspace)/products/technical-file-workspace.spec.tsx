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
    fireEvent.click(screen.getByRole("button", { name: "Open section" }));

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
});
