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
  useLegalEntitiesQuery: vi.fn(),
  useOrganizationBrandingQuery: vi.fn(),
  useOrganizationBrandingPreviewQuery: vi.fn(),
  useUpdateOrganizationSettingsMutation: vi.fn(),
  useUpdateRetentionMutation: vi.fn(),
  useCreateLegalEntityMutation: vi.fn(),
  useUpdateLegalEntityMutation: vi.fn(),
  useTransitionLegalEntityMutation: vi.fn(),
  useUpdateBrandingDraftMutation: vi.fn(),
  useBrandingLogoUploadMutation: vi.fn(),
  useBrandingPublishMutation: vi.fn(),
  useBrandingLogoRemoveMutation: vi.fn(),
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
const sbomQueries = vi.hoisted(() => ({
  useSbomCiCredentialsQuery: () => ({
    data: { credentials: [] },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCreateSbomCiCredentialMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useRevokeSbomCiCredentialMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));
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
vi.mock("../../_features/sboms/sboms.queries", () => sbomQueries);

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

const LEGAL_ENTITIES = {
  legalEntities: [
    {
      id: "99999999-9999-4999-8999-999999999999",
      organizationId: ORGANIZATION.id,
      identifier: "analytical-engines-gb",
      displayName: "Analytical Engines UK",
      legalName: "Analytical Engines Ltd",
      registeredAddress: {
        addressLine1: "1 Engine Way",
        locality: "London",
        postalCode: "SW1A 1AA",
        country: "GB",
      },
      mainEstablishmentCountry: "GB",
      phone: null,
      registrationIdentifier: "GB123456",
      taxIdentifier: "VAT987654",
      manufacturerContactName: "Ada Lovelace",
      manufacturerContactEmail: "ada@example.com",
      status: "active",
      completionStatus: "complete",
      isDefault: true,
      version: 2,
      dependencyProjections: [{ kind: "product", count: 1 }],
      createdAt: "2026-08-10T10:00:00.000Z",
      updatedAt: "2026-08-10T10:00:00.000Z",
      createdBy: "33333333-3333-4333-8333-333333333333",
      updatedBy: "33333333-3333-4333-8333-333333333333",
      deletedAt: null,
    },
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      organizationId: ORGANIZATION.id,
      identifier: null,
      displayName: "Legacy profile completion required",
      legalName: null,
      registeredAddress: null,
      mainEstablishmentCountry: null,
      phone: null,
      registrationIdentifier: null,
      taxIdentifier: null,
      manufacturerContactName: null,
      manufacturerContactEmail: null,
      status: "inactive",
      completionStatus: "needs_completion",
      isDefault: false,
      version: 0,
      dependencyProjections: [],
      createdAt: "2026-08-10T10:00:00.000Z",
      updatedAt: "2026-08-10T10:00:00.000Z",
      createdBy: "33333333-3333-4333-8333-333333333333",
      updatedBy: "33333333-3333-4333-8333-333333333333",
      deletedAt: null,
    },
  ],
} as const;

const BRANDING = {
  branding: {
    source: "sentinel",
    displayName: "CRA Sentinel",
    footerText: "CRA Sentinel",
    contactText: null,
    palette: {
      primary: "#0167FF",
      primaryText: "#FFFFFF",
      secondary: "#00A39B",
      secondaryText: "#000000",
    },
    logo: null,
    version: 0,
    publishedAt: null,
    updatedAt: "1970-01-01T00:00:00.000Z",
  },
} as const;

const BRANDING_PREVIEW = {
  branding: {
    source: "draft_preview",
    displayName: "CRA Sentinel Draft",
    footerText: "Draft footer",
    contactText: "draft-contact@analytical.test",
    palette: {
      primary: "#0167FF",
      primaryText: "#FFFFFF",
      secondary: "#00A39B",
      secondaryText: "#000000",
    },
    logo: {
      assetId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      width: 128,
      height: 128,
      mimeType: "image/webp",
      sha256: "a".repeat(64),
      altText: "AE logo",
    },
    version: 4,
    publishedAt: null,
    updatedAt: "2026-08-10T10:00:00.000Z",
  },
} as const;

const BRANDING_DRAFT_RESPONSE = {
  draft: {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    displayName: "Analytical Engines",
    footerText: "Draft footer",
    contactText: "draft-contact@analytical.test",
    palette: { primary: "#000000", secondary: "#00A39B" },
    logoAsset: {
      status: "approved",
      asset: BRANDING_PREVIEW.branding.logo,
    },
    version: 5,
    createdAt: "2026-08-10T10:00:00.000Z",
    updatedAt: "2026-08-10T10:00:00.000Z",
    createdBy: "33333333-3333-4333-8333-333333333333",
    updatedBy: "33333333-3333-4333-8333-333333333333",
  },
} as const;

const updateSettings = { mutateAsync: vi.fn(), isPending: false };
const updateRetention = { mutateAsync: vi.fn(), isPending: false };
const createLegalEntity = { mutateAsync: vi.fn(), isPending: false };
const updateLegalEntity = { mutateAsync: vi.fn(), isPending: false };
const transitionLegalEntity = { mutateAsync: vi.fn(), isPending: false };
const updateBranding = { mutateAsync: vi.fn(), isPending: false };
const uploadBrandingLogo = { mutateAsync: vi.fn(), isPending: false };
const publishBranding = { mutateAsync: vi.fn(), isPending: false };
const removeBrandingLogo = { mutateAsync: vi.fn(), isPending: false };
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
  queries.useLegalEntitiesQuery.mockReturnValue(okQuery(LEGAL_ENTITIES));
  queries.useOrganizationBrandingQuery.mockReturnValue(okQuery(BRANDING));
  queries.useOrganizationBrandingPreviewQuery.mockReturnValue(
    okQuery(BRANDING_PREVIEW),
  );
  queries.useUpdateOrganizationSettingsMutation.mockReturnValue(updateSettings);
  queries.useUpdateRetentionMutation.mockReturnValue(updateRetention);
  queries.useCreateLegalEntityMutation.mockReturnValue(createLegalEntity);
  queries.useUpdateLegalEntityMutation.mockReturnValue(updateLegalEntity);
  queries.useTransitionLegalEntityMutation.mockReturnValue(
    transitionLegalEntity,
  );
  queries.useUpdateBrandingDraftMutation.mockReturnValue(updateBranding);
  queries.useBrandingLogoUploadMutation.mockReturnValue(uploadBrandingLogo);
  queries.useBrandingPublishMutation.mockReturnValue(publishBranding);
  queries.useBrandingLogoRemoveMutation.mockReturnValue(removeBrandingLogo);
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

async function openOrganizationWorkspace(
  name: "Organization settings" | "Organization identity" | "Tenant lifecycle",
) {
  fireEvent.click(await screen.findByRole("button", { name }));
  return screen.findByRole("dialog", { name });
}

function selectOrganizationWorkspaceTab(name: string) {
  fireEvent.click(screen.getByRole("tab", { name }));
}

describe("OrganizationAdministrationPage", () => {
  it("opens organization controls in focused workbench dialogs for owners", async () => {
    render(<OrganizationAdministrationPage />);

    expect(await screen.findByText("Organization administration")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Analytical Engines Ltd" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "Organization workspace" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Organization workbench" }),
    ).toBeTruthy();
    expect(screen.queryByText("Evidence retention")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Organization settings" }),
    );

    expect(
      screen.getByRole("dialog", { name: "Organization settings" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Evidence retention" }),
    ).toBeTruthy();
    selectOrganizationWorkspaceTab("Evidence retention");
    const retentionButtons = screen.getAllByRole("button", {
      name: "Save retention",
    });
    expect(retentionButtons).toHaveLength(1);
    expect(retentionButtons[0]).toHaveClass("lg:self-end");
    selectOrganizationWorkspaceTab("Exports");
    expect(screen.getByText("Full tenant export")).toBeTruthy();
    const requestExportButton = screen.getByRole("button", {
      name: "Request export",
    });
    expect(requestExportButton).toBeEnabled();
    expect(requestExportButton.parentElement).toHaveClass("mt-auto");

    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(
      screen.getByRole("button", { name: "Organization identity" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Organization identity" }),
    ).toBeTruthy();
    expect(screen.getByText("Analytical Engines UK")).toBeTruthy();
    selectOrganizationWorkspaceTab("Branding");
    expect(screen.getByText("CRA Sentinel fallback active")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "Tenant lifecycle" }));
    expect(
      screen.getByRole("dialog", { name: "Tenant lifecycle" }),
    ).toBeTruthy();
    expect(screen.getByText("Deactivation and deletion")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reauthenticate" })).toHaveClass(
      "lg:self-end",
    );
    expect(
      screen.getByRole("button", { name: "Deactivate tenant" }),
    ).toHaveClass("lg:self-end");
  });

  it("resets to the first tab and closes the organization workbench with Escape", async () => {
    render(<OrganizationAdministrationPage />);

    const opener = await screen.findByRole("button", {
      name: "Organization settings",
    });
    fireEvent.click(opener);
    await screen.findByRole("dialog", { name: "Organization settings" });
    selectOrganizationWorkspaceTab("Exports");
    expect(screen.getByRole("tab", { name: "Exports" })).toHaveAttribute(
      "data-state",
      "active",
    );

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Organization settings" }),
      ).toBeNull(),
    );
    await waitFor(() => expect(opener).toHaveFocus());

    await openOrganizationWorkspace("Organization settings");
    expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute(
      "data-state",
      "active",
    );
  });

  it("preserves an unsaved settings draft while switching workbench tabs", async () => {
    render(<OrganizationAdministrationPage />);

    await openOrganizationWorkspace("Organization settings");
    const timezone = screen.getByLabelText("IANA timezone");
    fireEvent.change(timezone, { target: { value: "America/New_York" } });

    selectOrganizationWorkspaceTab("Evidence retention");
    selectOrganizationWorkspaceTab("Settings");

    expect(screen.getByLabelText("IANA timezone")).toHaveValue(
      "America/New_York",
    );
  });

  it("does not request organization data for a user without view permission", async () => {
    session.value = {
      ...session.value,
      permissions: {
        can_view_organization: false,
        can_edit_organization: false,
        can_export_organization: false,
        can_delete_organization: false,
      },
      role: "viewer",
    };

    render(<OrganizationAdministrationPage />);

    expect(
      await screen.findByText(
        "You do not have permission to view organization administration.",
      ),
    ).toBeTruthy();
    expect(queries.useCurrentOrganizationQuery).toHaveBeenCalledWith(false);
    expect(queries.useOrganizationSettingsQuery).toHaveBeenCalledWith(false);
    expect(queries.useOrganizationSettingsCatalogQuery).toHaveBeenCalledWith(
      false,
    );
    expect(queries.useOrganizationRetentionQuery).toHaveBeenCalledWith(false);
    expect(queries.useOrganizationLifecycleQuery).toHaveBeenCalledWith(false);
    expect(queries.useLegalEntitiesQuery).toHaveBeenCalledWith(false);
    expect(queries.useOrganizationBrandingQuery).toHaveBeenCalledWith(false);
    expect(queries.useOrganizationBrandingPreviewQuery).toHaveBeenCalledWith(
      false,
    );
  });

  it("keeps unaffected workspaces available when a secondary panel is unavailable", async () => {
    queries.useOrganizationBrandingQuery.mockReturnValue({
      ...okQuery(undefined),
      isError: true,
      error: new Error("branding unavailable"),
    });

    render(<OrganizationAdministrationPage />);

    expect(
      await screen.findByRole("heading", { name: "Organization workbench" }),
    ).toBeTruthy();
    await openOrganizationWorkspace("Organization settings");
    expect(screen.getByLabelText("IANA timezone")).toBeEnabled();
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
    await openOrganizationWorkspace("Organization settings");
    selectOrganizationWorkspaceTab("Exports");

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
    await openOrganizationWorkspace("Organization settings");
    selectOrganizationWorkspaceTab("Exports");

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
    await openOrganizationWorkspace("Organization settings");

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
    await openOrganizationWorkspace("Organization settings");

    expect(
      screen.getByRole("dialog", { name: "Organization settings" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save settings" })).toBeNull();
    selectOrganizationWorkspaceTab("Exports");
    expect(screen.queryByRole("button", { name: "Request export" })).toBeNull();
    expect(
      screen.getByText(/Only organization owners with export permission/),
    ).toBeTruthy();
  });

  it("submits a legal entity lifecycle action with the current version", async () => {
    transitionLegalEntity.mutateAsync.mockResolvedValue({
      legalEntity: {
        ...LEGAL_ENTITIES.legalEntities[0],
        status: "inactive",
        version: 3,
      },
    });
    render(<OrganizationAdministrationPage />);
    await openOrganizationWorkspace("Organization identity");

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Deactivate Analytical Engines UK",
      }),
    );

    await waitFor(() =>
      expect(transitionLegalEntity.mutateAsync).toHaveBeenCalledWith({
        legalEntityId: "99999999-9999-4999-8999-999999999999",
        input: { expectedVersion: 2, status: "inactive" },
      }),
    );
  });

  it("edits incomplete legal entities with explicit countries and phone", async () => {
    updateLegalEntity.mutateAsync.mockResolvedValue({
      legalEntity: {
        ...LEGAL_ENTITIES.legalEntities[1],
        identifier: "analytical-engines-eu",
        legalName: "Analytical Engines EU GmbH",
        registeredAddress: {
          addressLine1: "2 Engine Street",
          locality: "Berlin",
          postalCode: "10115",
          country: "DE",
        },
        mainEstablishmentCountry: "DE",
        phone: "+4930123456",
        manufacturerContactName: "Grace Hopper",
        manufacturerContactEmail: "grace@example.com",
        completionStatus: "complete",
        version: 1,
      },
    });
    render(<OrganizationAdministrationPage />);
    await openOrganizationWorkspace("Organization identity");

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Edit Legacy profile completion required",
      }),
    );
    fireEvent.change(screen.getByLabelText(/Entity identifier/), {
      target: { value: "analytical-engines-eu" },
    });
    fireEvent.change(screen.getByLabelText(/Legal name/), {
      target: { value: "Analytical Engines EU GmbH" },
    });
    fireEvent.change(screen.getByLabelText(/Main establishment country/), {
      target: { value: "DE" },
    });
    fireEvent.change(screen.getByLabelText(/Manufacturer contact name/), {
      target: { value: "Grace Hopper" },
    });
    fireEvent.change(screen.getByLabelText(/Manufacturer contact email/), {
      target: { value: "GRACE@EXAMPLE.COM" },
    });
    fireEvent.change(screen.getByLabelText(/Phone/), {
      target: { value: "+4930123456" },
    });
    fireEvent.change(screen.getByLabelText(/Address line 1/), {
      target: { value: "2 Engine Street" },
    });
    fireEvent.change(screen.getByLabelText(/Locality/), {
      target: { value: "Berlin" },
    });
    fireEvent.change(screen.getByLabelText(/Postal code/), {
      target: { value: "10115" },
    });
    fireEvent.change(screen.getByLabelText(/Registered address country/), {
      target: { value: "DE" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save legal entity" }));

    await waitFor(() =>
      expect(updateLegalEntity.mutateAsync).toHaveBeenCalledWith({
        legalEntityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        input: expect.objectContaining({
          expectedVersion: 0,
          identifier: "analytical-engines-eu",
          legalName: "Analytical Engines EU GmbH",
          mainEstablishmentCountry: "DE",
          phone: "+4930123456",
          registeredAddress: expect.objectContaining({
            addressLine1: "2 Engine Street",
            locality: "Berlin",
            postalCode: "10115",
            country: "DE",
          }),
          manufacturerContactEmail: "GRACE@EXAMPLE.COM",
        }),
      }),
    );
  });

  it("validates branding draft values and publishes with a fresh idempotency key", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    updateBranding.mutateAsync.mockResolvedValue(BRANDING_DRAFT_RESPONSE);
    publishBranding.mutateAsync.mockResolvedValue({
      branding: {
        ...BRANDING.branding,
        source: "published",
        displayName: "Analytical Engines",
        footerText: "Draft footer",
        contactText: "draft-contact@analytical.test",
        version: 1,
        publishedAt: "2026-08-10T10:00:00.000Z",
      },
    });
    render(<OrganizationAdministrationPage />);
    await openOrganizationWorkspace("Organization identity");
    selectOrganizationWorkspaceTab("Branding");

    fireEvent.change(await screen.findByLabelText(/Brand display name/), {
      target: { value: "Analytical Engines" },
    });
    fireEvent.change(screen.getByLabelText(/Primary brand color/), {
      target: { value: "#000000" },
    });
    fireEvent.change(screen.getByLabelText(/Footer text/), {
      target: { value: "Draft footer" },
    });
    fireEvent.change(screen.getByLabelText(/Contact text/), {
      target: { value: "draft-contact@analytical.test" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save branding draft" }),
    );
    await waitFor(() =>
      expect(updateBranding.mutateAsync).toHaveBeenCalledWith({
        expectedVersion: 4,
        displayName: "Analytical Engines",
        palette: { primary: "#000000", secondary: "#00A39B" },
        footerText: "Draft footer",
        contactText: "draft-contact@analytical.test",
        logoAssetId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Publish branding" }));
    await waitFor(() =>
      expect(publishBranding.mutateAsync).toHaveBeenCalledWith({
        expectedVersion: 5,
        idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
    );
  });

  it("renders the server-selected draft logo and uses the published version when removing it", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    queries.useOrganizationBrandingQuery.mockReturnValue(
      okQuery({
        branding: {
          ...BRANDING_PREVIEW.branding,
          source: "published" as const,
          logo: {
            ...BRANDING_PREVIEW.branding.logo,
            assetId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
            sha256: "b".repeat(64),
            altText: "Published logo",
          },
          version: 2,
          publishedAt: "2026-08-10T10:00:00.000Z",
        },
      }),
    );
    removeBrandingLogo.mutateAsync.mockResolvedValue({
      branding: {
        ...BRANDING_PREVIEW.branding,
        source: "published",
        logo: null,
        version: 3,
        publishedAt: "2026-08-10T10:01:00.000Z",
      },
    });
    render(<OrganizationAdministrationPage />);
    await openOrganizationWorkspace("Organization identity");
    selectOrganizationWorkspaceTab("Branding");

    const draftLogo = await screen.findByRole("img", { name: "AE logo" });
    expect(draftLogo).toHaveAttribute(
      "src",
      "/api/v1/organizations/current/branding/logo/preview?v=" + "a".repeat(64),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Remove published logo" }),
    );
    await waitFor(() =>
      expect(removeBrandingLogo.mutateAsync).toHaveBeenCalledWith({
        expectedVersion: 2,
        idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
    );

    expect(screen.getByRole("img", { name: "AE logo" })).toBeTruthy();
  });

  it("hides an unavailable draft logo instead of rendering a broken private asset", async () => {
    render(<OrganizationAdministrationPage />);
    await openOrganizationWorkspace("Organization identity");
    selectOrganizationWorkspaceTab("Branding");

    fireEvent.error(await screen.findByRole("img", { name: "AE logo" }));

    expect(
      await screen.findByText(
        "The selected logo is unavailable. No logo is displayed.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("img", { name: "AE logo" })).toBeNull();
  });

  it("uses object URLs only for temporary logo preview and revokes them on cleanup", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:local-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const createObjectURL = vi.mocked(URL.createObjectURL);
    const revokeObjectURL = vi.mocked(URL.revokeObjectURL);
    uploadBrandingLogo.mutateAsync.mockResolvedValue(BRANDING_DRAFT_RESPONSE);
    const { unmount } = render(<OrganizationAdministrationPage />);
    await openOrganizationWorkspace("Organization identity");
    selectOrganizationWorkspaceTab("Branding");

    const input = await screen.findByLabelText(/Logo image/);
    fireEvent.change(input, {
      target: {
        files: [new File(["png"], "logo.png", { type: "image/png" })],
      },
    });

    expect(
      await screen.findByRole("img", { name: "Selected logo preview" }),
    ).toHaveAttribute("src", "blob:local-preview");
    fireEvent.click(screen.getByRole("button", { name: "Upload logo" }));
    await waitFor(() =>
      expect(uploadBrandingLogo.mutateAsync).toHaveBeenCalledWith({
        fields: { altText: "AE logo" },
        file: expect.any(File),
      }),
    );

    unmount();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:local-preview");
  });

  it("handles a server-side forbidden response even when presentation permissions are stale", async () => {
    queries.useOrganizationRetentionQuery.mockReturnValue({
      ...okQuery(undefined),
      isError: true,
      error: new ApiClientError("api", "Denied", 403, "forbidden"),
    });
    render(<OrganizationAdministrationPage />);

    expect(
      await screen.findByText(
        "You no longer have access to organization administration.",
      ),
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
    await openOrganizationWorkspace("Tenant lifecycle");

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
    await openOrganizationWorkspace("Tenant lifecycle");

    fireEvent.change(
      await screen.findByLabelText(/Fresh password confirmation/),
      {
        target: { value: "Password123" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Reauthenticate" }));
    await screen.findByText("Fresh destructive authorization is ready.");

    const confirmation = screen.getByLabelText(/Purge confirmation/);
    expect(confirmation).toHaveAttribute(
      "placeholder",
      "DELETE analytical-engines-ltd",
    );
    expect(
      screen.getByRole("button", { name: "Schedule purge" }),
    ).toBeDisabled();

    fireEvent.change(confirmation, {
      target: { value: "DELETE another-tenant" },
    });
    expect(
      screen.getByRole("button", { name: "Schedule purge" }),
    ).toBeDisabled();

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
    await openOrganizationWorkspace("Organization settings");

    const maximumAge = await screen.findByLabelText(
      /Maximum session age minutes/,
    );
    fireEvent.change(maximumAge, { target: { value: "240" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(
      await screen.findByRole("button", { name: "Refresh settings" }),
    ).toBeEnabled();
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
    await openOrganizationWorkspace("Tenant lifecycle");

    expect(await screen.findByText(/Changed .* UTC/)).toBeTruthy();
  });

  it("resets administration-only drafts when the server-selected organization changes", async () => {
    const view = render(<OrganizationAdministrationPage />);
    await openOrganizationWorkspace("Organization settings");
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
    expect(screen.getByLabelText(/Maximum session age minutes/)).toHaveValue(
      120,
    );
  });

  it("keeps recovery available throughout the scheduled grace period, but not after purging", async () => {
    queries.useOrganizationLifecycleQuery.mockReturnValue(
      okQuery({
        lifecycle: { ...LIFECYCLE.lifecycle, status: "purge_scheduled" },
      }),
    );
    render(<OrganizationAdministrationPage />);
    await openOrganizationWorkspace("Tenant lifecycle");
    expect(
      await screen.findByRole("button", { name: "Recover tenant" }),
    ).toBeVisible();

    cleanup();
    queries.useOrganizationLifecycleQuery.mockReturnValue(
      okQuery({ lifecycle: { ...LIFECYCLE.lifecycle, status: "purging" } }),
    );
    render(<OrganizationAdministrationPage />);
    await openOrganizationWorkspace("Tenant lifecycle");
    expect(await screen.findByText(/restoration is unavailable/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Recover tenant" })).toBeNull();
  });
});
