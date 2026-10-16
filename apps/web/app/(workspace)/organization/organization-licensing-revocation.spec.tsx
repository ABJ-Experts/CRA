// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../_lib/http/api-client";
import {
  usageSnapshot,
  usageOrganizationId,
} from "../../_features/licensing/test/usage-fixtures";
import { OrganizationLicensingSection } from "./organization-licensing-section";
const fixture = vi.hoisted(() => ({
  policy: vi.fn(),
  current: vi.fn(),
  history: vi.fn(),
  activate: vi.fn(),
  usage: vi.fn(),
  exportUsage: vi.fn(),
  reconcileUsage: vi.fn(),
}));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => ({
    session: {
      organization: { id: "22222222-2222-4222-8222-222222222222" },
      user: { id: "actor" },
    },
    permissions: { can_view_licensing: true, can_manage_licensing: true },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("../../_providers/providers", () => ({ useMocksReady: () => true }));
vi.mock("../../_features/licensing/licensing-gateway", () => ({
  LicensingGateway: class {
    policy = fixture.policy;
    current = fixture.current;
    history = fixture.history;
    activate = fixture.activate;
    usage = fixture.usage;
    exportUsage = fixture.exportUsage;
    reconcileUsage = fixture.reconcileUsage;
  },
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});
describe("licensing panel mutation authorization", () => {
  it.each([
    ["Export JSON", false],
    ["Reconcile usage", false],
    ["Export JSON", true],
    ["Reconcile usage", true],
  ] as const)(
    "clears all cached licence details immediately after %s is forbidden (slow refetch: %s)",
    async (label, slowRefetch) => {
      vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "false");
      fixture.policy.mockResolvedValue({ state: "missing" });
      fixture.current.mockResolvedValue({
        version: 2,
        instanceId: "private-instance-binding",
        claims: null,
        lastRejected: null,
        policy: {
          state: "missing",
          reasons: [],
          warnings: [],
          effectiveCapabilities: [],
          disabledCapabilities: [],
          customerWritesAllowed: false,
          expiresAt: null,
          graceEndsAt: null,
        },
      });
      fixture.history.mockResolvedValue({
        items: [
          {
            id: "history",
            occurredAt: "2026-10-13T00:00:00.000Z",
            action: "activated",
            reason: null,
          },
        ],
      });
      fixture.usage.mockResolvedValue(usageSnapshot());
      fixture.exportUsage.mockRejectedValue(
        new ApiClientError("api", "Forbidden", 403),
      );
      fixture.reconcileUsage.mockRejectedValue(
        new ApiClientError("api", "Forbidden", 403),
      );
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <QueryClientProvider client={client}>
          <OrganizationLicensingSection organizationId={usageOrganizationId} />
        </QueryClientProvider>,
      );
      await screen.findByText("private-instance-binding");
      await waitFor(() =>
        expect(screen.getByRole("button", { name: label })).toBeEnabled(),
      );
      if (slowRefetch) fixture.usage.mockReturnValue(new Promise(() => {}));
      fireEvent.click(screen.getByRole("button", { name: label }));
      await screen.findByText(/You do not have permission to view licences/);
      expect(
        screen.queryByText("private-instance-binding"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByLabelText("Signed licence artifact"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/activated/)).not.toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    },
  );
});
