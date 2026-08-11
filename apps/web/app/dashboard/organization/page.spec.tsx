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
import OrganizationAdministrationPage from "./page";

const queries = vi.hoisted(() => ({
  useCurrentOrganizationQuery: vi.fn(),
  useOrganizationSettingsQuery: vi.fn(),
  useOrganizationSettingsCatalogQuery: vi.fn(),
  useOrganizationRetentionQuery: vi.fn(),
  useOrganizationLifecycleQuery: vi.fn(),
  useUpdateOrganizationSettingsMutation: vi.fn(),
  useUpdateRetentionMutation: vi.fn(),
  useRequestExportMutation: vi.fn(),
  useLatestOrganizationExportQuery: vi.fn(),
  useOrganizationExportQuery: vi.fn(),
  useDownloadOrganizationExportMutation: vi.fn(),
  useReauthenticateOrganizationMutation: vi.fn(),
  useDeactivateOrganizationMutation: vi.fn(),
  useScheduleOrganizationPurgeMutation: vi.fn(),
  useRecoverOrganizationMutation: vi.fn(),
}));
const api = vi.hoisted(() => ({
  organizationsApi: {
    exportStatus: vi.fn(),
    downloadExport: vi.fn(),
  },
}));
const mocks = vi.hoisted(() => ({ ready: true }));
const session = vi.hoisted(() => ({
  value: {
    session: {
      organizations: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Analytical Engines Ltd",
        },
      ],
    },
    permissions: {
      can_view_organization: true,
      can_edit_organization: true,
      can_export_organization: true,
      can_delete_organization: true,
    },
    role: "owner",
    isLoading: false,
    isError: false,
  },
}));

vi.mock("../../_features/organizations/organizations.queries", () => queries);
vi.mock("../../_features/organizations/organizations.api", () => api);
vi.mock("../../_providers/providers", () => ({
  useMocksReady: () => mocks.ready,
}));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => session.value,
}));

const ORGANIZATION = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Analytical Engines Ltd",
  slug: "analytical-engines-ltd",
  legalProfile: null,
} as const;

const SETTINGS = {
  settings: {
    status: "configured",
    version: 2,
    values: {
      timezone: "Europe/London",
      workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      holidays: ["2026-12-25"],
      notificationChannelIds: ["email"],
      mfaEnforcementDate: null,
      maximumSessionAgeMinutes: 480,
      aiProviderId: "disabled",
      dataResidencyId: "eu",
    },
  },
  mfaRolloutReadiness: {
    enrolledMemberCount: 1,
    unenrolledMemberCount: 0,
    safeToEnforce: true,
  },
} as const;

const CATALOG = {
  catalog: {
    timezones: ["Europe/London", "America/New_York"],
    notificationChannels: ["email", "in_app"],
    aiProviders: ["disabled", "approved_provider"],
    dataResidencies: ["eu", "us"],
    minimumSessionAgeMinutes: 5,
    maximumSessionAgeMinutes: 43200,
  },
} as const;

const RETENTION = {
  policies: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      evidenceClass: "sbom",
      version: 3,
      requestedRetentionDays: 365,
      effectiveRetentionDays: 730,
      effectiveFloorDays: 730,
      controllingReasons: [
        {
          kind: "obligation",
          recordId: "33333333-3333-4333-8333-333333333333",
          requiredRetentionDays: 730,
        },
      ],
      createdAt: "2026-08-10T10:00:00.000Z",
      updatedAt: "2026-08-10T10:00:00.000Z",
    },
  ],
} as const;

const LIFECYCLE = {
  lifecycle: {
    status: "active",
    version: 4,
    changedAt: "2026-08-10T10:00:00.000Z",
    blockers: [],
    error: null,
  },
} as const;

const updateSettings = { mutateAsync: vi.fn(), isPending: false };
const updateRetention = { mutateAsync: vi.fn(), isPending: false };
const requestExport = { mutateAsync: vi.fn(), isPending: false };
const exportStatus = { data: undefined, isPending: false, isError: false };
const latestExport = {
  data: { export: null },
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};
const downloadExport = { mutateAsync: vi.fn(), isPending: false };
const reauth = { mutateAsync: vi.fn(), isPending: false };
const deactivate = { mutateAsync: vi.fn(), isPending: false };
const schedulePurge = { mutateAsync: vi.fn(), isPending: false };
const recover = { mutateAsync: vi.fn(), isPending: false };

function okQuery(data: unknown) {
  return {
    data,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  session.value = {
    ...session.value,
    permissions: {
      can_view_organization: true,
      can_edit_organization: true,
      can_export_organization: true,
      can_delete_organization: true,
    },
    role: "owner",
  };
  queries.useCurrentOrganizationQuery.mockReturnValue(
    okQuery({ organization: ORGANIZATION }),
  );
  queries.useOrganizationSettingsQuery.mockReturnValue(okQuery(SETTINGS));
  queries.useOrganizationSettingsCatalogQuery.mockReturnValue(okQuery(CATALOG));
  queries.useOrganizationRetentionQuery.mockReturnValue(okQuery(RETENTION));
  queries.useOrganizationLifecycleQuery.mockReturnValue(okQuery(LIFECYCLE));
  queries.useUpdateOrganizationSettingsMutation.mockReturnValue(updateSettings);
  queries.useUpdateRetentionMutation.mockReturnValue(updateRetention);
  queries.useRequestExportMutation.mockReturnValue(requestExport);
  queries.useLatestOrganizationExportQuery.mockReturnValue(latestExport);
  queries.useOrganizationExportQuery.mockReturnValue(exportStatus);
  queries.useDownloadOrganizationExportMutation.mockReturnValue(downloadExport);
  queries.useReauthenticateOrganizationMutation.mockReturnValue(reauth);
  queries.useDeactivateOrganizationMutation.mockReturnValue(deactivate);
  queries.useScheduleOrganizationPurgeMutation.mockReturnValue(schedulePurge);
  queries.useRecoverOrganizationMutation.mockReturnValue(recover);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("OrganizationAdministrationPage", () => {
  it("renders settings, retention, export, and lifecycle controls for owners", async () => {
    render(<OrganizationAdministrationPage />);

    expect(await screen.findByText("Organization administration")).toBeTruthy();
    expect(screen.getByText("Analytical Engines Ltd")).toBeTruthy();
    expect(screen.getByText("Evidence retention")).toBeTruthy();
    expect(screen.getByText("Full tenant export")).toBeTruthy();
    expect(screen.getByText("Deactivation and deletion")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Request export" }),
    ).toBeEnabled();
  });

  it("reuses the same export idempotency key when a browser retry follows a failed request", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "77777777-7777-4777-8777-777777777777",
    );
    requestExport.mutateAsync
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({
        export: {
          id: "88888888-8888-4888-8888-888888888888",
          status: "queued",
          progress: { completedParts: 0, totalParts: 1 },
          error: null,
          manifest: null,
          createdAt: "2026-08-10T10:00:00.000Z",
          updatedAt: "2026-08-10T10:00:00.000Z",
        },
        idempotent: true,
      });
    render(<OrganizationAdministrationPage />);

    const requestButton = await screen.findByRole("button", {
      name: "Request export",
    });
    fireEvent.click(requestButton);
    await screen.findByText("Export request could not be queued.");

    fireEvent.click(requestButton);
    await screen.findByText("Existing export request resumed.");

    expect(requestExport.mutateAsync).toHaveBeenNthCalledWith(1, {
      idempotencyKey: "77777777-7777-4777-8777-777777777777",
    });
    expect(requestExport.mutateAsync).toHaveBeenNthCalledWith(2, {
      idempotencyKey: "77777777-7777-4777-8777-777777777777",
    });
  });

  it("restores a server-owned latest export after a browser restart", async () => {
    queries.useLatestOrganizationExportQuery.mockReturnValue({
      ...latestExport,
      data: {
        export: {
          id: "88888888-8888-4888-8888-888888888888",
          status: "running",
          progress: { completedParts: 2, totalParts: 5 },
          error: null,
          manifest: null,
          createdAt: "2026-08-10T10:00:00.000Z",
          updatedAt: "2026-08-10T10:01:00.000Z",
        },
      },
    });
    render(<OrganizationAdministrationPage />);

    expect(await screen.findByText("Status: Running")).toBeTruthy();
    expect(screen.getByText("Progress: 2/5 parts")).toBeTruthy();
    expect(queries.useOrganizationExportQuery).toHaveBeenCalledWith(
      "88888888-8888-4888-8888-888888888888",
      true,
    );
  });

  it("submits settings with the current version and selected server-catalog values", async () => {
    updateSettings.mutateAsync.mockResolvedValue(SETTINGS);
    render(<OrganizationAdministrationPage />);

    fireEvent.change(
      await screen.findByLabelText(/Maximum session age minutes/),
      {
        target: { value: "240" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(updateSettings.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedVersion: 2,
          values: expect.objectContaining({
            timezone: "Europe/London",
            maximumSessionAgeMinutes: 240,
            aiProviderId: "disabled",
            dataResidencyId: "eu",
          }),
        }),
      ),
    );
  });

  it("hides mutation controls from read-only viewers while preserving read state", async () => {
    session.value = {
      ...session.value,
      permissions: {
        can_view_organization: true,
        can_edit_organization: false,
        can_export_organization: false,
        can_delete_organization: false,
      },
      role: "viewer",
    };

    render(<OrganizationAdministrationPage />);

    expect(await screen.findByText("Evidence retention")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save settings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Request export" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reauthenticate" })).toBeNull();
    expect(
      screen.getByText(/Only organization owners with export permission/),
    ).toBeTruthy();
  });

  it("handles a server-side forbidden response even when presentation permissions are stale", async () => {
    queries.useOrganizationRetentionQuery.mockReturnValue({
      ...okQuery(undefined),
      isError: true,
      error: new ApiClientError("api", "Denied", 403, "forbidden"),
    });
    render(<OrganizationAdministrationPage />);

    expect(
      await screen.findByText("You no longer have access to organization administration."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  it("uses fresh reauthentication before deactivation", async () => {
    reauth.mutateAsync.mockResolvedValue({
      reauthenticationGrantId: "44444444-4444-4444-8444-444444444444",
      expiresAt: "2026-08-10T10:05:00.000Z",
    });
    deactivate.mutateAsync.mockResolvedValue(LIFECYCLE);
    render(<OrganizationAdministrationPage />);

    fireEvent.change(
      await screen.findByLabelText(/Fresh password confirmation/),
      {
        target: { value: "Password123" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Reauthenticate" }));
    await screen.findByText("Fresh destructive authorization is ready.");
    fireEvent.change(screen.getByLabelText(/Deactivation confirmation/), {
      target: { value: "DEACTIVATE ORGANIZATION" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Deactivate tenant" }));

    await waitFor(() =>
      expect(deactivate.mutateAsync).toHaveBeenCalledWith({
        reauthenticationGrantId: "44444444-4444-4444-8444-444444444444",
        expectedVersion: 4,
        confirmation: "DEACTIVATE ORGANIZATION",
      }),
    );
  });

  it("requires an exact owner-entered purge confirmation and never derives it", async () => {
    reauth.mutateAsync.mockResolvedValue({
      reauthenticationGrantId: "44444444-4444-4444-8444-444444444444",
      expiresAt: "2026-08-10T10:05:00.000Z",
    });
    schedulePurge.mutateAsync.mockResolvedValue({
      lifecycle: { ...LIFECYCLE.lifecycle, status: "purge_scheduled" },
    });
    queries.useOrganizationLifecycleQuery.mockReturnValue(
      okQuery({ lifecycle: { ...LIFECYCLE.lifecycle, status: "deactivated" } }),
    );
    render(<OrganizationAdministrationPage />);

    fireEvent.change(await screen.findByLabelText(/Fresh password confirmation/), {
      target: { value: "Password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reauthenticate" }));
    await screen.findByText("Fresh destructive authorization is ready.");

    const confirmation = screen.getByLabelText(/Purge confirmation/);
    expect(confirmation).toHaveAttribute("placeholder", "DELETE analytical-engines-ltd");
    expect(screen.getByRole("button", { name: "Schedule purge" })).toBeDisabled();

    fireEvent.change(confirmation, { target: { value: "DELETE another-tenant" } });
    expect(screen.getByRole("button", { name: "Schedule purge" })).toBeDisabled();

    fireEvent.change(confirmation, {
      target: { value: "DELETE analytical-engines-ltd" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Schedule purge" }));

    await waitFor(() =>
      expect(schedulePurge.mutateAsync).toHaveBeenCalledWith({
        reauthenticationGrantId: "44444444-4444-4444-8444-444444444444",
        expectedVersion: 4,
        confirmation: "DELETE analytical-engines-ltd",
      }),
    );
  });

  it("keeps settings form input on a conflict and provides an accessible refresh action", async () => {
    const refetch = vi.fn();
    queries.useOrganizationSettingsQuery.mockReturnValue({
      ...okQuery(SETTINGS),
      refetch,
    });
    updateSettings.mutateAsync.mockRejectedValue(
      new ApiClientError("api", "Settings changed", 409, "conflict"),
    );
    render(<OrganizationAdministrationPage />);

    const maximumAge = await screen.findByLabelText(/Maximum session age minutes/);
    fireEvent.change(maximumAge, { target: { value: "240" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByRole("button", { name: "Refresh settings" })).toBeEnabled();
    expect(maximumAge).toHaveValue(240);
    fireEvent.click(screen.getByRole("button", { name: "Refresh settings" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("labels lifecycle instants as UTC when the organization has not configured a timezone", async () => {
    queries.useOrganizationSettingsQuery.mockReturnValue(
      okQuery({
        ...SETTINGS,
        settings: { status: "unconfigured", version: 0, values: null },
      }),
    );
    render(<OrganizationAdministrationPage />);

    expect(await screen.findByText(/Changed .* UTC/)).toBeTruthy();
  });

  it("resets administration-only drafts when the server-selected organization changes", async () => {
    const view = render(<OrganizationAdministrationPage />);
    expect(
      await screen.findByLabelText(/Maximum session age minutes/),
    ).toHaveValue(480);

    queries.useCurrentOrganizationQuery.mockReturnValue(
      okQuery({
        organization: {
          ...ORGANIZATION,
          id: "99999999-9999-4999-8999-999999999999",
          name: "Second Organization Ltd",
        },
      }),
    );
    queries.useOrganizationSettingsQuery.mockReturnValue(
      okQuery({
        ...SETTINGS,
        settings: {
          ...SETTINGS.settings,
          values: {
            ...SETTINGS.settings.values,
            maximumSessionAgeMinutes: 120,
          },
        },
      }),
    );
    view.rerender(<OrganizationAdministrationPage />);

    expect(screen.getByText("Second Organization Ltd")).toBeTruthy();
    expect(screen.getByLabelText(/Maximum session age minutes/)).toHaveValue(120);
  });

  it("keeps recovery available throughout the scheduled grace period, but not after purging", async () => {
    queries.useOrganizationLifecycleQuery.mockReturnValue(
      okQuery({ lifecycle: { ...LIFECYCLE.lifecycle, status: "purge_scheduled" } }),
    );
    render(<OrganizationAdministrationPage />);
    expect(await screen.findByRole("button", { name: "Recover tenant" })).toBeVisible();

    cleanup();
    queries.useOrganizationLifecycleQuery.mockReturnValue(
      okQuery({ lifecycle: { ...LIFECYCLE.lifecycle, status: "purging" } }),
    );
    render(<OrganizationAdministrationPage />);
    expect(await screen.findByText(/restoration is unavailable/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Recover tenant" })).toBeNull();
  });
});
