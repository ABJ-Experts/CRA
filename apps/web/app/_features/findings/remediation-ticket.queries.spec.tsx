// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VulnerabilityRemediationTicketsResponse } from "@repo/contracts/vulnerabilities";

import { vulnerabilityTriageApi } from "./triage.api";
import { useVulnerabilityRemediationTicketsQuery } from "./triage.queries";

const firstOrganization = "22222222-2222-4222-8222-222222222222";
const secondOrganization = "33333333-3333-4333-8333-333333333333";
const state = vi.hoisted(() => ({
  organizationId: "22222222-2222-4222-8222-222222222222",
}));

vi.mock("../../_providers/session-provider", () => ({
  useSession: () => ({
    session: { organization: { id: state.organizationId } },
  }),
}));
vi.mock("./triage.api", () => ({
  vulnerabilityTriageApi: { remediationTickets: vi.fn() },
}));

const findingId = "11111111-1111-4111-8111-111111111111";
const firstBindingId = "44444444-4444-4444-8444-444444444444";
const secondBindingId = "55555555-5555-4555-8555-555555555555";

function ticketResponse(
  bindingId: string,
): VulnerabilityRemediationTicketsResponse {
  return {
    bindings: [
      {
        id: bindingId,
        connectorId: "66666666-6666-4666-8666-666666666666",
        productId: "77777777-7777-4777-8777-777777777777",
        provider: "jira",
        cloudId: "88888888-8888-4888-8888-888888888888",
        projectId: "10000",
        projectKey: "SEC",
        issueTypeId: "10001",
        externalBaseUrl: "https://cra-test.atlassian.net",
        statusTransitions: [
          {
            fromStatusId: "1",
            toStatusId: "2",
            transitionId: "3",
          },
        ],
        statusMappings: [{ statusId: "1", workState: "open" }],
        customFieldMappings: [],
        status: "active",
        version: 1,
        createdAt: "2026-09-08T10:00:00.000Z",
        updatedAt: "2026-09-08T10:00:00.000Z",
      },
    ],
    tickets: [],
  };
}

describe("remediation ticket query isolation", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    state.organizationId = firstOrganization;
  });

  it("does not expose cached ticket state while switching organizations", async () => {
    let resolveOther:
      ((value: VulnerabilityRemediationTicketsResponse) => void) | undefined;
    vi.mocked(vulnerabilityTriageApi.remediationTickets).mockImplementation(
      async () => {
        if (state.organizationId === firstOrganization)
          return ticketResponse(firstBindingId);
        return new Promise<VulnerabilityRemediationTicketsResponse>(
          (resolve) => {
            resolveOther = resolve;
          },
        );
      },
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: Readonly<{ children: ReactNode }>) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      () => useVulnerabilityRemediationTicketsQuery(findingId, true),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.data?.bindings[0]?.id).toBe(firstBindingId),
    );

    state.organizationId = secondOrganization;
    rerender();
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(true);

    await act(async () => {
      resolveOther?.(ticketResponse(secondBindingId));
    });
    await waitFor(() =>
      expect(result.current.data?.bindings[0]?.id).toBe(secondBindingId),
    );
    expect(vulnerabilityTriageApi.remediationTickets).toHaveBeenCalledTimes(2);
  });
});
