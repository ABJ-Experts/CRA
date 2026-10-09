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

import { CiBindingsContent } from "./ci-bindings-content";

const state = vi.hoisted(() => ({
  role: "owner",
  bindings: {
    data: { bindings: [] as Record<string, unknown>[] },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  runs: {
    data: { runs: [] as Record<string, unknown>[] },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  create: { mutateAsync: vi.fn(), isPending: false },
  revoke: { mutateAsync: vi.fn(), isPending: false },
  connectors: {
    data: { connectors: { rows: [] as Record<string, unknown>[], total: 0 } },
    isPending: false,
    isError: false,
  },
  credentials: {
    data: { credentials: [] as Record<string, unknown>[] },
    isPending: false,
    isError: false,
  },
  products: {
    data: { products: { rows: [] as Record<string, unknown>[], total: 0 } },
    isPending: false,
    isError: false,
  },
  releases: {
    data: { releases: { rows: [] as Record<string, unknown>[], total: 0 } },
    isPending: false,
    isError: false,
  },
}));

vi.mock("../../../_providers/providers", () => ({ useMocksReady: () => true }));
vi.mock("../../../_providers/session-provider", () => ({
  useSession: () => ({
    session: { organization: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } },
    role: state.role,
    permissions: { can_view_connectors: true },
  }),
}));
vi.mock("../../../_features/sboms/ci-bindings.queries", () => ({
  useCiBindingsQuery: () => state.bindings,
  useCiBindingRunsQuery: () => state.runs,
  useCreateCiBindingMutation: () => state.create,
  useRevokeCiBindingMutation: () => state.revoke,
}));
vi.mock("../../../_features/connectors/connectors.queries", () => ({
  useConnectorOverviewsQuery: () => state.connectors,
}));
vi.mock("../../../_features/sboms/sboms.queries", () => ({
  useSbomCiCredentialsQuery: () => state.credentials,
}));
vi.mock("../../../_features/products/products.queries", () => ({
  useProductsQuery: () => state.products,
  useProductReleasesQuery: () => state.releases,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  state.role = "owner";
  state.bindings = {
    data: { bindings: [] },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  };
  state.runs = {
    data: { runs: [] },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  };
  state.create = { mutateAsync: vi.fn(), isPending: false };
});

describe("CI binding owner workspace", () => {
  it("does not expose a binding form to nonowners", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "false");
    state.role = "member";
    render(<CiBindingsContent />);
    expect(screen.getByText(/Only organization owners/i)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Create binding/i }),
    ).not.toBeInTheDocument();
  });

  it("preserves entered repository identity after a server conflict", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "false");
    state.create.mutateAsync = vi.fn(async () => {
      throw new Error("Conflict");
    });
    state.connectors.data.connectors.rows = [
      {
        connector: {
          id: "11111111-1111-4111-8111-111111111111",
          connectorType: "github_actions",
          displayName: "GitHub App",
          enabled: true,
          archivedAt: null,
        },
      },
    ];
    state.credentials.data.credentials = [
      {
        id: "22222222-2222-4222-8222-222222222222",
        label: "CI",
        revokedAt: null,
      },
    ];
    state.products.data.products.rows = [
      { id: "33333333-3333-4333-8333-333333333333", name: "Device" },
    ];
    state.releases.data.releases.rows = [
      { id: "44444444-4444-4444-8444-444444444444", label: "1.0" },
    ];
    render(<CiBindingsContent />);
    fireEvent.change(screen.getByLabelText("Connector"), {
      target: { value: "11111111-1111-4111-8111-111111111111" },
    });
    fireEvent.change(screen.getByLabelText("Product"), {
      target: { value: "33333333-3333-4333-8333-333333333333" },
    });
    fireEvent.change(screen.getByLabelText("Release"), {
      target: { value: "44444444-4444-4444-8444-444444444444" },
    });
    fireEvent.change(screen.getByLabelText("CI credential"), {
      target: { value: "22222222-2222-4222-8222-222222222222" },
    });
    for (const [label, value] of [
      ["Repository owner", "acme"],
      ["Repository name", "device"],
      ["Repository ID", "42"],
      ["Allowed ref", "refs/heads/main"],
      ["GitHub App installation ID", "77"],
    ] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(screen.getByRole("button", { name: "Create binding" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeVisible());
    expect(screen.getByLabelText("Repository ID")).toHaveValue("42");
    expect(state.create.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryId: "42",
        providerHost: "github.com",
      }),
    );
  });

  it("shows nonpassing run status and revokes with the current version", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "false");
    const id = "11111111-1111-4111-8111-111111111111";
    state.bindings.data.bindings = [
      {
        id,
        version: 3,
        status: "active",
        provider: "github_actions",
        repositoryOwner: "acme",
        repositoryName: "device",
        repositoryId: "42",
        allowedRef: "refs/heads/main",
        productId: "33333333-3333-4333-8333-333333333333",
        releaseId: "44444444-4444-4444-8444-444444444444",
      },
    ];
    state.runs.data.runs = [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        runId: "build-42",
        runAttempt: "1",
        createdAt: "2026-09-30T10:00:00Z",
        commitSha: "a".repeat(40),
        ref: "refs/heads/main",
        state: "policy_not_configured",
        sourceId: null,
        jobId: null,
      },
    ];
    state.revoke.mutateAsync = vi.fn(async () => ({}));
    render(<CiBindingsContent />);
    fireEvent.click(screen.getByRole("button", { name: "Recent builds" }));
    expect(screen.getByText("policy not configured")).toBeVisible();
    expect(screen.getByRole("cell", { name: /build-42 \/ 1/ })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(state.revoke.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          bindingId: id,
          input: expect.objectContaining({ expectedVersion: 3 }),
        }),
      ),
    );
  });
});
