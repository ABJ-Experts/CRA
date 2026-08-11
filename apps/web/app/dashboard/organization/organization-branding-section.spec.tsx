// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import type {
  OrganizationBrandingDraft,
  ResolvedOrganizationBranding,
} from "@repo/contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationBrandingSection } from "./organization-branding-section";

const mutations = vi.hoisted(() => ({
  update: { mutateAsync: vi.fn(), isPending: false },
  upload: { mutateAsync: vi.fn(), isPending: false },
  publish: { mutateAsync: vi.fn(), isPending: false },
  remove: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock("../../_features/organizations/organizations.queries", () => ({
  useUpdateBrandingDraftMutation: () => mutations.update,
  useBrandingLogoUploadMutation: () => mutations.upload,
  useBrandingPublishMutation: () => mutations.publish,
  useBrandingLogoRemoveMutation: () => mutations.remove,
}));

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const LOGO = {
  assetId: "22222222-2222-4222-8222-222222222222",
  width: 128,
  height: 128,
  mimeType: "image/webp",
  sha256: "a".repeat(64),
  altText: "Analytical Engines logo",
} as const;

const DRAFT_WITH_LOGO = {
  id: "33333333-3333-4333-8333-333333333333",
  displayName: "Analytical Engines Draft",
  footerText: "Draft footer",
  contactText: "branding@example.test",
  palette: { primary: "#0167FF", secondary: "#00A39B" },
  logoAsset: { status: "approved", asset: LOGO },
  version: 5,
  createdAt: "2026-08-10T10:00:00.000Z",
  updatedAt: "2026-08-10T10:00:00.000Z",
  createdBy: ORGANIZATION_ID,
  updatedBy: ORGANIZATION_ID,
} as const satisfies OrganizationBrandingDraft;

const DRAFT_WITHOUT_LOGO = {
  ...DRAFT_WITH_LOGO,
  footerText: null,
  contactText: null,
  logoAsset: { status: "none", asset: null },
  version: 6,
} as const satisfies OrganizationBrandingDraft;

const DRAFT_PREVIEW = {
  source: "draft_preview",
  displayName: "Analytical Engines Draft",
  footerText: "Draft footer",
  contactText: "branding@example.test",
  palette: {
    primary: "#0167FF",
    primaryText: "#FFFFFF",
    secondary: "#00A39B",
    secondaryText: "#000000",
  },
  logo: LOGO,
  version: 5,
  publishedAt: null,
  updatedAt: "2026-08-10T10:00:00.000Z",
} as const satisfies ResolvedOrganizationBranding;

const SENTINEL = {
  source: "sentinel",
  displayName: "CRA Sentinel",
  footerText: null,
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
} as const satisfies ResolvedOrganizationBranding;

const PUBLISHED = {
  ...DRAFT_PREVIEW,
  source: "published",
  version: 3,
  publishedAt: "2026-08-10T10:00:00.000Z",
} as const satisfies ResolvedOrganizationBranding;

function renderSection({
  resolvedBranding = PUBLISHED,
  draftPreview = DRAFT_PREVIEW,
  canManage = true,
}: Partial<React.ComponentProps<typeof OrganizationBrandingSection>> = {}) {
  const onRefresh = vi.fn();
  render(
    <OrganizationBrandingSection
      resolvedBranding={resolvedBranding}
      draftPreview={draftPreview}
      canManage={canManage}
      organizationTimezone="Europe/London"
      onRefresh={onRefresh}
    />,
  );
  return { onRefresh };
}

beforeEach(() => {
  vi.clearAllMocks();
  mutations.update.mutateAsync.mockResolvedValue({ draft: DRAFT_WITH_LOGO });
  mutations.upload.mutateAsync.mockResolvedValue({ draft: DRAFT_WITH_LOGO });
  mutations.publish.mutateAsync.mockResolvedValue({ branding: PUBLISHED });
  mutations.remove.mutateAsync.mockResolvedValue({ branding: PUBLISHED });
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
    "44444444-4444-4444-8444-444444444444",
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("OrganizationBrandingSection", () => {
  it("shows the server's draft snapshot to viewers without exposing owner controls", () => {
    renderSection({
      resolvedBranding: { ...DRAFT_PREVIEW, footerText: null },
      draftPreview: { ...SENTINEL, source: "draft_preview", version: 4 },
      canManage: false,
    });

    expect(screen.getByText("Draft preview version 5")).toBeInTheDocument();
    expect(screen.getByText("Secondary brand surface")).toBeInTheDocument();
    expect(screen.getByText("Not published")).toBeInTheDocument();
    expect(
      screen.getByText(/only organization owners with edit permission/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save branding draft" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Publish branding" }),
    ).not.toBeInTheDocument();
  });

  it("sends null optional presentation text and clears a removed draft logo", async () => {
    mutations.update.mutateAsync.mockResolvedValue({ draft: DRAFT_WITHOUT_LOGO });
    const { onRefresh } = renderSection();

    fireEvent.change(screen.getByLabelText("Footer text"), {
      target: { value: "   " },
    });
    fireEvent.change(screen.getByLabelText("Contact text"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save branding draft" }));

    await waitFor(() =>
      expect(mutations.update.mutateAsync).toHaveBeenCalledWith({
        expectedVersion: 5,
        displayName: "Analytical Engines Draft",
        palette: { primary: "#0167FF", secondary: "#00A39B" },
        footerText: null,
        contactText: null,
        logoAssetId: LOGO.assetId,
      }),
    );
    expect(await screen.findByText("Branding draft saved.")).toBeInTheDocument();
    expect(screen.getByText("No organization logo")).toBeInTheDocument();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("keeps branding access available while each server-side mutation fails", async () => {
    mutations.update.mutateAsync.mockRejectedValue(new Error("network"));
    mutations.upload.mutateAsync.mockRejectedValue(new Error("network"));
    mutations.publish.mutateAsync.mockRejectedValue(new Error("network"));
    mutations.remove.mutateAsync.mockRejectedValue(new Error("network"));
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:logo-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: "Save branding draft" }));
    expect(
      await screen.findByText("Branding draft could not be saved."),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Logo image"), {
      target: {
        files: [new File(["logo"], "logo.png", { type: "image/png" })],
      },
    });
    fireEvent.change(screen.getByLabelText("Logo alt text"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload logo" }));
    await waitFor(() =>
      expect(mutations.upload.mutateAsync).toHaveBeenCalledWith({
        fields: {},
        file: expect.any(File),
      }),
    );
    expect(await screen.findByText("Logo could not be uploaded.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Publish branding" }));
    expect(
      await screen.findByText("Branding could not be published."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove published logo" }));
    await waitFor(() =>
      expect(mutations.remove.mutateAsync).toHaveBeenCalledWith({
        expectedVersion: 3,
        idempotencyKey: "44444444-4444-4444-8444-444444444444",
      }),
    );
    expect(await screen.findByText("Logo could not be removed.")).toBeInTheDocument();
  });
});
