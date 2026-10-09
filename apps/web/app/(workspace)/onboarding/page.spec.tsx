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

import { ApiClientError } from "../../_lib/http/api-client";
import OnboardingPage from "./page";

const queries = vi.hoisted(() => ({
  useCurrentOrganizationQuery: vi.fn(),
  useOnboardingQuery: vi.fn(),
  useCreateOrganizationMutation: vi.fn(),
  useSwitchOrganizationMutation: vi.fn(),
  useUpdateLegalProfileMutation: vi.fn(),
}));
const mocks = vi.hoisted(() => ({ ready: true }));
const session = vi.hoisted(
  () =>
    ({
      value: {
        session: null,
        isLoading: false,
      },
    }) as {
      value: {
        session: {
          organizations: ReadonlyArray<{ id: string; name: string }>;
        } | null;
        isLoading: boolean;
        permissions?: Record<string, boolean>;
      };
    },
);

vi.mock("../../_features/organizations/organizations.queries", () => queries);
vi.mock("../../_providers/providers", () => ({
  useMocksReady: () => mocks.ready,
}));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => session.value,
}));
vi.mock("./invitation-manager", () => ({
  InvitationManager: () => <div>Team invitations</div>,
}));

const refetchCurrent = vi.fn();
const refetchOnboarding = vi.fn();
const create = { mutateAsync: vi.fn(), isPending: false };
const switchOrganization = { mutateAsync: vi.fn(), isPending: false };
const updateLegalProfile = { mutateAsync: vi.fn(), isPending: false };

const ORGANIZATION = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Analytical Engines Ltd",
  slug: "analytical-engines-ltd",
  legalProfile: null,
} as const;

const LEGAL_PROFILE = {
  id: "22222222-2222-4222-8222-222222222222",
  legalName: "Analytical Engines Ltd",
  registeredAddress: {
    addressLine1: "1 Engine Way",
    locality: "London",
    postalCode: "SW1A 1AA",
    country: "GB",
  },
  mainEstablishmentCountry: "GB",
  phone: null,
  manufacturerContactName: "Ada Lovelace",
  manufacturerContactEmail: "ada@example.com",
  version: 3,
  createdAt: "2026-08-10T10:00:00.000Z",
  updatedAt: "2026-08-10T10:00:00.000Z",
  createdBy: "22222222-2222-4222-8222-222222222222",
  updatedBy: "22222222-2222-4222-8222-222222222222",
} as const;

const PROFILED_ORGANIZATION = {
  ...ORGANIZATION,
  legalProfile: LEGAL_PROFILE,
} as const;

function progress(nextIncompleteStage: string | null = "first_product") {
  return {
    organization: ORGANIZATION,
    stages: [
      {
        stage: "organization_details",
        status: "completed",
        resourceIds: [],
        unavailableResourceIds: [],
        completedAt: "2026-08-10T10:00:00.000Z",
        actorId: "22222222-2222-4222-8222-222222222222",
        blockReason: null,
      },
      {
        stage: "first_product",
        status: "blocked",
        resourceIds: [],
        unavailableResourceIds: [],
        completedAt: null,
        actorId: null,
        blockReason: "awaiting_authoritative_product",
      },
      {
        stage: "first_sbom",
        status: "blocked",
        resourceIds: [],
        unavailableResourceIds: [],
        completedAt: null,
        actorId: null,
        blockReason: "awaiting_authoritative_sbom",
      },
      {
        stage: "invite_team",
        status: "pending",
        resourceIds: [],
        unavailableResourceIds: [],
        completedAt: null,
        actorId: null,
        blockReason: null,
      },
      {
        stage: "completed",
        status: nextIncompleteStage === null ? "completed" : "blocked",
        resourceIds: [],
        unavailableResourceIds: [],
        completedAt:
          nextIncompleteStage === null ? "2026-08-10T11:00:00.000Z" : null,
        actorId:
          nextIncompleteStage === null
            ? "22222222-2222-4222-8222-222222222222"
            : null,
        blockReason:
          nextIncompleteStage === null ? null : "awaiting_prior_stage",
      },
    ],
    nextIncompleteStage,
    blocked: nextIncompleteStage !== null,
    integrationAvailability: {
      products: false,
      sbom: false,
      invitations: true,
    },
  } as const;
}

function currentQuery(
  organization:
    typeof ORGANIZATION | typeof PROFILED_ORGANIZATION | null = null,
) {
  return {
    data: { organization },
    isPending: false,
    isError: false,
    error: null,
    refetch: refetchCurrent,
  };
}

function onboardingQuery(data = progress()) {
  return {
    data,
    isPending: false,
    isError: false,
    error: null,
    refetch: refetchOnboarding,
  };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "false");
  mocks.ready = true;
  session.value = {
    session: { organizations: [ORGANIZATION] },
    isLoading: false,
    permissions: { can_edit_organization: true },
  };
  queries.useCurrentOrganizationQuery.mockReturnValue(currentQuery());
  queries.useOnboardingQuery.mockReturnValue(onboardingQuery());
  queries.useCreateOrganizationMutation.mockReturnValue(create);
  queries.useSwitchOrganizationMutation.mockReturnValue(switchOrganization);
  queries.useUpdateLegalProfileMutation.mockReturnValue(updateLegalProfile);
  create.mutateAsync.mockResolvedValue(ORGANIZATION);
  updateLegalProfile.mutateAsync.mockResolvedValue(PROFILED_ORGANIZATION);
  switchOrganization.mutateAsync.mockResolvedValue({
    organization: ORGANIZATION,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("OnboardingPage", () => {
  it("renders a legal profile form and validates required fields before create", async () => {
    session.value = { session: null, isLoading: false };
    render(<OnboardingPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Create organization" }),
    );

    expect(await screen.findAllByRole("alert")).not.toHaveLength(0);
    expect(create.mutateAsync).not.toHaveBeenCalled();
  });

  it("requires an explicit choice for both country fields", async () => {
    session.value = { session: null, isLoading: false };
    render(<OnboardingPage />);

    fireEvent.change(screen.getByLabelText(/Legal organization name/), {
      target: { value: "Analytical Engines Ltd" },
    });
    fireEvent.change(screen.getByLabelText(/Registered address line 1/), {
      target: { value: "1 Engine Way" },
    });
    fireEvent.change(screen.getByLabelText(/City or locality/), {
      target: { value: "London" },
    });
    fireEvent.change(screen.getByLabelText(/Postal code/), {
      target: { value: "SW1A 1AA" },
    });
    fireEvent.change(screen.getByLabelText(/Manufacturer contact name/), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.change(screen.getByLabelText(/Manufacturer contact email/), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create organization" }),
    );

    expect(await screen.findAllByText("Select a country")).toHaveLength(2);
    expect(create.mutateAsync).not.toHaveBeenCalled();
  });

  it("creates the complete legal profile and preserves values after a server error", async () => {
    session.value = { session: null, isLoading: false };
    create.mutateAsync.mockRejectedValue(
      new ApiClientError(
        "api",
        "That legal profile already exists.",
        409,
        "legal_identity_conflict",
        { legalName: "Use the registered legal name." },
      ),
    );
    render(<OnboardingPage />);

    fireEvent.change(screen.getByLabelText(/Legal organization name/), {
      target: { value: "Analytical Engines Ltd" },
    });
    fireEvent.change(screen.getByLabelText(/Registered address line 1/), {
      target: { value: "1 Engine Way" },
    });
    fireEvent.change(screen.getByLabelText(/City or locality/), {
      target: { value: "London" },
    });
    fireEvent.change(screen.getByLabelText(/Postal code/), {
      target: { value: "SW1A 1AA" },
    });
    fireEvent.change(screen.getByLabelText(/Manufacturer contact name/), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.change(screen.getByLabelText(/Manufacturer contact email/), {
      target: { value: "ADA@EXAMPLE.COM" },
    });
    fireEvent.click(screen.getByLabelText(/Main establishment country/));
    fireEvent.click(screen.getByRole("option", { name: "United Kingdom" }));
    fireEvent.click(screen.getByLabelText(/Registered address country/));
    fireEvent.click(screen.getByRole("option", { name: "United Kingdom" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Create organization" }),
    );

    await waitFor(() =>
      expect(create.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          legalName: "Analytical Engines Ltd",
          registeredAddress: expect.objectContaining({
            addressLine1: "1 Engine Way",
            locality: "London",
            postalCode: "SW1A 1AA",
            country: "GB",
          }),
          mainEstablishmentCountry: "GB",
          manufacturerContactName: "Ada Lovelace",
          manufacturerContactEmail: "ada@example.com",
          idempotencyKey: expect.any(String),
        }),
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "That legal profile already exists.",
    );
    expect(screen.getAllByText("Use the registered legal name.")).toHaveLength(
      2,
    );
    expect(screen.getByLabelText(/Legal organization name/)).toHaveValue(
      "Analytical Engines Ltd",
    );
  });

  it("renders an explicit forbidden state with a retry action", () => {
    queries.useCurrentOrganizationQuery.mockReturnValue({
      ...currentQuery(),
      isError: true,
      error: new ApiClientError("api", "Forbidden", 403),
    });
    render(<OnboardingPage />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "do not have access to organization onboarding",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetchCurrent).toHaveBeenCalledOnce();
  });

  it("renders loading, mock-only, and onboarding retry states without creating client progress", () => {
    queries.useCurrentOrganizationQuery.mockReturnValue({
      ...currentQuery(),
      isPending: true,
    });
    const view = render(<OnboardingPage />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading organization setup",
    );

    mocks.ready = false;
    view.rerender(<OnboardingPage />);
    expect(screen.getByText(/live backend is enabled/)).toBeVisible();

    mocks.ready = true;
    queries.useCurrentOrganizationQuery.mockReturnValue(
      currentQuery(PROFILED_ORGANIZATION),
    );
    queries.useOnboardingQuery.mockReturnValue({
      ...onboardingQuery(),
      isError: true,
      error: new ApiClientError("network", "offline"),
    });
    view.rerender(<OnboardingPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "could not load organization onboarding",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetchOnboarding).toHaveBeenCalledOnce();
  });

  it("renders only server-reported progress, blocks Product and SBOM, and links invitations to existing management", () => {
    queries.useCurrentOrganizationQuery.mockReturnValue(
      currentQuery(PROFILED_ORGANIZATION),
    );
    render(<OnboardingPage />);

    expect(screen.getByText("Organization details")).toBeVisible();
    expect(screen.getAllByText("Integration unavailable")).toHaveLength(2);
    expect(screen.getByText("Team invitations")).toBeVisible();
    expect(screen.queryByLabelText(/invite email/i)).not.toBeInTheDocument();
  });

  it("lets an organization administrator edit the versioned legal profile", async () => {
    queries.useCurrentOrganizationQuery.mockReturnValue(
      currentQuery(PROFILED_ORGANIZATION),
    );
    render(<OnboardingPage />);

    fireEvent.click(screen.getByRole("button", { name: "Edit legal profile" }));
    expect(screen.getByLabelText(/Legal organization name/)).toHaveValue(
      "Analytical Engines Ltd",
    );
    fireEvent.change(screen.getByLabelText(/Legal organization name/), {
      target: { value: "Analytical Engines (UK) Ltd" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save legal profile" }));

    await waitFor(() =>
      expect(updateLegalProfile.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          legalName: "Analytical Engines (UK) Ltd",
          expectedVersion: 3,
        }),
      ),
    );
  });

  it("shows the completed state from the server without client-side completion storage", () => {
    queries.useCurrentOrganizationQuery.mockReturnValue(
      currentQuery(PROFILED_ORGANIZATION),
    );
    queries.useOnboardingQuery.mockReturnValue(onboardingQuery(progress(null)));
    render(<OnboardingPage />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Organization onboarding is complete",
    );
  });

  it("switches only among session organizations and retains a server switch error", async () => {
    const secondOrganization = {
      ...ORGANIZATION,
      id: "33333333-3333-4333-8333-333333333333",
      name: "Babbage Instruments Ltd",
    };
    session.value = {
      session: {
        organizations: [ORGANIZATION, secondOrganization],
      },
      isLoading: false,
    };
    queries.useCurrentOrganizationQuery.mockReturnValue(
      currentQuery(ORGANIZATION),
    );
    switchOrganization.mutateAsync.mockRejectedValue(
      new ApiClientError("api", "Organization not found.", 404),
    );
    render(<OnboardingPage />);

    fireEvent.click(screen.getByLabelText("Current organization"));
    fireEvent.click(
      screen.getByRole("option", { name: "Babbage Instruments Ltd" }),
    );

    await waitFor(() =>
      expect(switchOrganization.mutateAsync).toHaveBeenCalledWith(
        secondOrganization.id,
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Organization not found.",
    );
  });
});
