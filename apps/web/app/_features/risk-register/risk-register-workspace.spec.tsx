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

import { ApiClientError } from "../../_lib/http/api-client";
import { RiskRegisterWorkspace } from "./risk-register-workspace";

const query = vi.hoisted(() => ({
  useRiskRegisterQuery: vi.fn(),
  useCreateRiskMutation: vi.fn(),
  useUpdateRiskMutation: vi.fn(),
  useAcceptResidualRiskMutation: vi.fn(),
  useArchiveRiskMutation: vi.fn(),
}));

vi.mock("../../_providers/session-provider", () => ({
  useSession: () => ({
    session: { user: { id: "11111111-1111-4111-8111-111111111111" } },
    role: "owner",
  }),
}));
vi.mock("./risk-register.queries", () => query);

const risk = {
  id: "22222222-2222-4222-8222-222222222222",
  organizationId: "33333333-3333-4333-8333-333333333333",
  productId: "44444444-4444-4444-8444-444444444444",
  registerId: "55555555-5555-4555-8555-555555555555",
  version: 1,
  status: "review_required",
  archivedAt: null,
  archivedByUserId: null,
  archiveRationale: null,
  residualRiskAcceptance: null,
  currentRevision: {
    id: "66666666-6666-4666-8666-666666666666",
    revision: 1,
    threat: "Unauthenticated network command",
    affectedAssets: [],
    requirements: [],
    inherentAssessment: {
      likelihood: 4,
      impact: 4,
      likelihoodRationale: "Reachable",
      impactRationale: "Control loss",
      level: "high",
    },
    mitigations: "Require mutual authentication.",
    residualAssessment: {
      likelihood: 2,
      impact: 2,
      likelihoodRationale: "Protected",
      impactRationale: "Limited",
      level: "low",
    },
    revisionRationale: "Initial assessment.",
    ownerId: "11111111-1111-4111-8111-111111111111",
    evidenceReferences: [],
    createdByUserId: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-09-14T00:00:00.000Z",
  },
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt: "2026-09-14T00:00:00.000Z",
} as const;

const linkedRisk = {
  ...risk,
  currentRevision: {
    ...risk.currentRevision,
    affectedAssets: [
      {
        id: "77777777-7777-4777-8777-777777777777",
        componentId: "77777777-7777-4777-8777-777777777777",
        componentName: "openssl",
        componentVersion: "3.0.12",
        sbomDocumentId: "88888888-8888-4888-8888-888888888888",
        observedRevision:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        status: "current",
      },
    ],
    requirements: [
      {
        id: "99999999-9999-4999-8999-999999999999",
        identifier: "Annex I Part I (1)",
        edition: "CRA 2024",
        sourceReference: "Regulation (EU) 2024/2847",
        rationale: "Secure-by-design mapping.",
        status: "unresolved",
      },
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        identifier: "Annex I Part I (2)",
        edition: "CRA 2024",
        sourceReference: "Regulation (EU) 2024/2847",
        rationale: "Attack-surface reduction mapping.",
        status: "unresolved",
      },
    ],
    evidenceReferences: [
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        title: "Penetration test report",
        recordId: null,
        observedRevision: null,
        locator: "QA-SEC-2026-09",
        rationale: "Confirms the mitigation was tested.",
        status: "current",
      },
    ],
  },
} as const;

const mutations = {
  create: vi.fn(),
  update: vi.fn(),
  accept: vi.fn(),
  archive: vi.fn(),
};

function prime(data: unknown = { riskRegister: { risks: [risk] } }) {
  query.useRiskRegisterQuery.mockReturnValue({
    isPending: false,
    isError: false,
    data,
    refetch: vi.fn(),
  });
  query.useCreateRiskMutation.mockReturnValue({
    isPending: false,
    mutateAsync: mutations.create,
  });
  query.useUpdateRiskMutation.mockReturnValue({
    isPending: false,
    mutateAsync: mutations.update,
  });
  query.useAcceptResidualRiskMutation.mockReturnValue({
    isPending: false,
    mutateAsync: mutations.accept,
  });
  query.useArchiveRiskMutation.mockReturnValue({
    isPending: false,
    mutateAsync: mutations.archive,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RiskRegisterWorkspace", () => {
  it("shows an actionable operational risk row with an explicit unresolved mapping state", () => {
    prime();
    render(
      <RiskRegisterWorkspace
        productId="44444444-4444-4444-8444-444444444444"
        enabled
        canEdit
      />,
    );
    expect(
      screen.getByText("Unauthenticated network command"),
    ).toBeInTheDocument();
    expect(screen.getByText("review required")).toBeInTheDocument();
    expect(screen.getByText("0 unresolved")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open risk" }));
    expect(screen.getByText("Risk detail")).toBeInTheDocument();
    expect(
      screen.getByText(/Initial assessment and prior revisions are retained/),
    ).toBeInTheDocument();
  });

  it("preserves the create form after local validation fails", () => {
    prime({ riskRegister: null });
    render(
      <RiskRegisterWorkspace
        productId="44444444-4444-4444-8444-444444444444"
        enabled
        canEdit
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create risk" }));
    const threat = screen.getByLabelText("Threat");
    fireEvent.change(threat, { target: { value: "Persist this threat" } });
    fireEvent.click(screen.getByRole("button", { name: "Create risk" }));
    expect(
      screen.getByText(/Complete every required risk field/),
    ).toBeInTheDocument();
    expect(threat).toHaveValue("Persist this threat");
  });

  it("preserves multiple mappings and evidence references when saving a revision", async () => {
    mutations.update.mockResolvedValue({ risk: linkedRisk });
    prime({ riskRegister: { risks: [linkedRisk] } });
    render(
      <RiskRegisterWorkspace
        productId="44444444-4444-4444-8444-444444444444"
        enabled
        canEdit
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open risk" }));
    fireEvent.click(screen.getByRole("button", { name: "Save risk revision" }));

    await waitFor(() => expect(mutations.update).toHaveBeenCalledOnce());
    expect(mutations.update).toHaveBeenCalledWith(
      expect.objectContaining({
        requirements: expect.arrayContaining([
          expect.objectContaining({ identifier: "Annex I Part I (1)" }),
          expect.objectContaining({ identifier: "Annex I Part I (2)" }),
        ]),
        evidenceReferences: [
          expect.objectContaining({
            title: "Penetration test report",
            locator: "QA-SEC-2026-09",
          }),
        ],
      }),
    );
  });

  it("offers retry for an unavailable register", () => {
    prime();
    const refetch = vi.fn();
    query.useRiskRegisterQuery.mockReturnValue({
      isPending: false,
      isError: true,
      error: new ApiClientError("network", "Offline"),
      refetch,
    });
    render(
      <RiskRegisterWorkspace
        productId="44444444-4444-4444-8444-444444444444"
        enabled
        canEdit
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
