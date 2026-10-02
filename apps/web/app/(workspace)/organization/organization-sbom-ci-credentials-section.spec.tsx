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

import { OrganizationSbomCiCredentialsSection } from "./organization-sbom-ci-credentials-section";

const state = vi.hoisted(() => ({
  credentials: {
    data: { credentials: [] as readonly unknown[] },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  },
  create: { isPending: false, mutateAsync: vi.fn() },
  revoke: { isPending: false, mutateAsync: vi.fn() },
}));

vi.mock("../../_features/sboms/sboms.queries", () => ({
  useSbomCiCredentialsQuery: () => state.credentials,
  useCreateSbomCiCredentialMutation: () => state.create,
  useRevokeSbomCiCredentialMutation: () => state.revoke,
}));

afterEach(() => {
  cleanup();
  state.credentials = {
    data: { credentials: [] },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
  state.create = { isPending: false, mutateAsync: vi.fn() };
  state.revoke = { isPending: false, mutateAsync: vi.fn() };
});

describe("OrganizationSbomCiCredentialsSection", () => {
  it("keeps credential authority owner-only in the presentation layer", () => {
    render(<OrganizationSbomCiCredentialsSection enabled canManage={false} />);
    expect(screen.getByText(/Only organization owners/i)).toBeVisible();
    expect(screen.queryByLabelText("Credential label")).not.toBeInTheDocument();
  });

  it("shows a newly created secret once and never puts it in the credential list", async () => {
    state.create.mutateAsync = vi.fn(async () => ({
      credential: {
        id: "11111111-1111-4111-8111-111111111111",
        organizationId: "22222222-2222-4222-8222-222222222222",
        label: "GitHub Actions",
        tokenPrefix: "cra_sbom_abcdefgh",
        createdAt: "2026-08-20T12:00:00.000Z",
        createdBy: "33333333-3333-4333-8333-333333333333",
        revokedAt: null,
        revokedBy: null,
        lastUsedAt: null,
      },
      secret: `cra_sbom_${"s".repeat(32)}`,
    }));
    render(<OrganizationSbomCiCredentialsSection enabled canManage />);

    fireEvent.change(screen.getByLabelText("Credential label"), {
      target: { value: "GitHub Actions" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create credential" }));

    await waitFor(() =>
      expect(screen.getByText(/Copy this credential now/i)).toBeVisible(),
    );
    expect(screen.getByText(`cra_sbom_${"s".repeat(32)}`)).toBeVisible();
    expect(state.create.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ label: "GitHub Actions" }),
    );
  });
});
