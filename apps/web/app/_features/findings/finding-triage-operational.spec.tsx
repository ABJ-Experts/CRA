// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FindingTriageOperational,
  triageOperationalRequestMessage,
} from "./finding-triage-operational";
import { ApiClientError } from "../../_lib/http/api-client";

const suppress = vi.fn();
const assign = vi.fn();

vi.mock("../../_providers/session-provider", () => ({
  useSession: () => ({ role: "owner" }),
  useHasPermission: (permission: string) =>
    permission === "can_edit_findings" ||
    permission === "can_edit_organization",
}));

vi.mock("./triage.queries", () => ({
  useAssignVulnerabilityTriageFindingMutation: () => ({
    isPending: false,
    mutateAsync: assign,
  }),
  useSuppressVulnerabilityTriageFindingMutation: () => ({
    isPending: false,
    mutateAsync: suppress,
  }),
  useVulnerabilityTriageSlaPoliciesQuery: () => ({
    data: { policies: [] },
    isError: false,
  }),
  useUpdateVulnerabilityTriageSlaPolicyMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));

const operational = {
  version: 3,
  assignee: {
    userId: "11111111-1111-4111-8111-111111111111",
    displayName: "Analyst",
  },
  suppression: {
    state: "suppressed" as const,
    reason: "Vendor maintenance window.",
    expiresAt: "2030-01-01T00:00:00.000Z",
    revision: 2,
  },
  internalSla: {
    state: "paused" as const,
    severity: "high" as const,
    targetMinutes: 60,
    startedAt: "2026-09-08T10:00:00.000Z",
    pausedAt: "2026-09-08T10:05:00.000Z",
    dueAt: "2026-09-08T11:00:00.000Z",
  },
  notification: {
    state: "retrying" as const,
    lastAttemptAt: "2026-09-08T10:05:00.000Z",
    deliveredAt: null,
    failureMessage: "Provider unavailable.",
  },
  remediation: {
    state: "not_recorded" as const,
    anchor: null,
    reintroduction: {
      state: "not_reintroduced" as const,
      fromFindingId: null,
      detectedAt: null,
    },
  },
};

describe("FindingTriageOperational", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("keeps suppression, internal SLA, and delivery failure distinct from VEX", () => {
    render(
      <FindingTriageOperational
        findingId="22222222-2222-4222-8222-222222222222"
        operational={operational}
      />,
    );

    expect(screen.getByText("Suppressed until")).toBeInTheDocument();
    expect(screen.getByText("Internal triage SLA")).toBeInTheDocument();
    expect(screen.getAllByText("Delivery Retrying")).not.toHaveLength(0);
    expect(
      screen.getByText(/does not change VEX, risk, or regulatory deadlines/i),
    ).toBeInTheDocument();
  });

  it("requires entered suppression evidence and preserves the form after recoverable failure", async () => {
    suppress.mockRejectedValueOnce(new ApiClientError("network", "", 0));
    render(
      <FindingTriageOperational
        findingId="22222222-2222-4222-8222-222222222222"
        operational={{
          ...operational,
          suppression: {
            state: "actionable",
            reason: null,
            expiresAt: null,
            revision: null,
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Suppress finding" }));
    fireEvent.click(screen.getByRole("button", { name: "Save suppression" }));
    expect(screen.getByText("A reason is required.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Suppression reason"), {
      target: { value: "Vendor maintenance window." },
    });
    fireEvent.change(screen.getByLabelText("Suppression expiry"), {
      target: { value: "2030-01-01T00:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save suppression" }));

    expect(await screen.findByText(/offline/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Suppression reason")).toHaveValue(
      "Vendor maintenance window.",
    );
  });

  it("closes the suppression dialog only after a successful save", async () => {
    suppress.mockResolvedValueOnce(undefined);
    render(
      <FindingTriageOperational
        findingId="22222222-2222-4222-8222-222222222222"
        operational={{
          ...operational,
          suppression: {
            state: "actionable",
            reason: null,
            expiresAt: null,
            revision: null,
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Suppress finding" }));
    const dialog = screen.getAllByRole("dialog").at(-1);
    if (!dialog) throw new Error("Suppression dialog did not open");
    fireEvent.change(within(dialog).getByLabelText("Suppression reason"), {
      target: { value: "Vendor maintenance window." },
    });
    fireEvent.change(within(dialog).getByLabelText("Suppression expiry"), {
      target: { value: "2030-01-01T00:00" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save suppression" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Suppress finding" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("explains conflict and revoked-access recovery", () => {
    expect(
      triageOperationalRequestMessage(new ApiClientError("api", "", 409)),
    ).toContain("changed");
    expect(
      triageOperationalRequestMessage(new ApiClientError("api", "", 403)),
    ).toContain("permission");
  });
});
