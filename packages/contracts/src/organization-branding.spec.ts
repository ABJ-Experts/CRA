import type {
  OrganizationBranding,
  OrganizationBrandingDraft,
  ResolvedOrganizationBranding,
} from "./organizations/types/index.js";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  CRA_SENTINEL_BRANDING,
  BRANDING_MAX_LOGO_BYTES,
  BRANDING_MAX_LOGO_DIMENSION_PIXELS,
  BRANDING_MAX_LOGO_PIXELS,
  BRANDING_MIN_CONTRAST_RATIO,
  BRANDING_MIN_LOGO_DIMENSION_PIXELS,
  organizationBrandingSchema,
  organizationBrandingDraftResponseSchema,
  organizationBrandingDraftSchema,
  publishOrganizationBrandingInputSchema,
  resolveOrganizationBranding,
  resolveTextColor,
} from "./organizations.js";

const logoAssetId = "43333333-3333-4333-8333-333333333333";
const actorId = "44444444-4444-4444-8444-444444444444";

describe("organization-branding contracts", () => {
  it("publishes the immutable logo and contrast policy limits", () => {
    expect(BRANDING_MAX_LOGO_BYTES).toBe(2 * 1024 * 1024);
    expect(BRANDING_MIN_LOGO_DIMENSION_PIXELS).toBe(64);
    expect(BRANDING_MAX_LOGO_DIMENSION_PIXELS).toBe(2048);
    expect(BRANDING_MAX_LOGO_PIXELS).toBe(16_000_000);
    expect(BRANDING_MIN_CONTRAST_RATIO).toBe(4.5);
  });

  it("derives a WCAG AA black-or-white text color for each palette value", () => {
    expect(resolveTextColor("#FFFFFF")).toEqual({
      color: "#000000",
      contrastRatio: 21,
    });
    expect(resolveTextColor("#000000")).toEqual({
      color: "#FFFFFF",
      contrastRatio: 21,
    });
    expect(resolveTextColor("#595FE5").contrastRatio).toBeGreaterThanOrEqual(
      BRANDING_MIN_CONTRAST_RATIO,
    );
  });

  it("strictly parses a published brand without exposing a storage path or URL", () => {
    const branding = {
      source: "published",
      displayName: "Acme Ireland",
      footerText: "Acme Ireland Limited",
      contactText: "Contact Acme Ireland support",
      version: 3,
      palette: {
        primary: "#595fe5",
        primaryText: "#FFFFFF",
        secondary: "#F3935D",
        secondaryText: "#000000",
      },
      logo: {
        assetId: logoAssetId,
        width: 128,
        height: 128,
        mimeType: "image/webp",
        sha256: "a".repeat(64),
        altText: "Acme Ireland logo",
      },
      publishedAt: "2026-08-11T12:00:00.000Z",
      updatedAt: "2026-08-11T12:00:00.000Z",
    } as const;

    expect(organizationBrandingSchema.parse(branding)).toEqual({
      ...branding,
      palette: { ...branding.palette, primary: "#595FE5" },
    });
    expect(
      organizationBrandingSchema.safeParse({
        ...branding,
        storagePath: "organization-branding/secret.webp",
      }).success,
    ).toBe(false);
    expect(
      organizationBrandingSchema.safeParse({
        ...branding,
        primaryColor: "#123",
      }).success,
    ).toBe(false);
    expect(
      organizationBrandingSchema.safeParse({
        ...branding,
        source: "sentinel",
        version: 0,
        publishedAt: null,
      }).success,
    ).toBe(false);
    expect(
      organizationBrandingSchema.safeParse({ ...branding, version: 0 }).success,
    ).toBe(false);
    expectTypeOf(
      organizationBrandingSchema.parse,
    ).returns.toEqualTypeOf<OrganizationBranding>();
  });

  it("requires idempotency and an optimistic version to publish branding", () => {
    expect(
      publishOrganizationBrandingInputSchema.parse({
        expectedVersion: 3,
        idempotencyKey: "44444444-4444-4444-8444-444444444444",
      }),
    ).toEqual({
      expectedVersion: 3,
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    });
    expect(
      publishOrganizationBrandingInputSchema.safeParse({
        expectedVersion: 3,
        idempotencyKey: "not-a-uuid",
      }).success,
    ).toBe(false);
  });

  it("models a versioned mutable draft with an approved, storage-safe asset", () => {
    const draft = {
      id: "45555555-5555-4555-8555-555555555555",
      displayName: "  Acme Ireland  ",
      palette: { primary: "#595fe5", secondary: "#F3935D" },
      footerText: "  Acme Ireland Limited  ",
      contactText: "  Contact Acme Ireland support  ",
      logoAsset: {
        status: "approved",
        asset: {
          assetId: logoAssetId,
          width: 128,
          height: 128,
          mimeType: "image/webp",
          sha256: "a".repeat(64),
          altText: "Acme Ireland logo",
        },
      },
      version: 2,
      createdAt: "2026-08-11T12:00:00.000Z",
      updatedAt: "2026-08-11T12:30:00.000Z",
      createdBy: actorId,
      updatedBy: actorId,
    } as const;

    expect(organizationBrandingDraftSchema.parse(draft)).toMatchObject({
      displayName: "Acme Ireland",
      footerText: "Acme Ireland Limited",
      contactText: "Contact Acme Ireland support",
      logoAsset: { status: "approved", asset: { assetId: logoAssetId } },
    });
    expect(organizationBrandingDraftResponseSchema.parse({ draft })).toEqual({
      draft: organizationBrandingDraftSchema.parse(draft),
    });
    expect(
      organizationBrandingDraftSchema.safeParse({
        ...draft,
        logoAsset: { status: "approved", asset: null },
      }).success,
    ).toBe(false);
    expectTypeOf(
      organizationBrandingDraftSchema.parse,
    ).returns.toEqualTypeOf<OrganizationBrandingDraft>();
  });

  it("resolves a draft preview with safe footer and contact text", () => {
    const preview = organizationBrandingSchema.parse({
      source: "draft_preview",
      displayName: "Acme Ireland",
      footerText: "Acme Ireland Limited",
      contactText: "Contact Acme Ireland support",
      palette: {
        primary: "#595FE5",
        primaryText: "#FFFFFF",
        secondary: "#F3935D",
        secondaryText: "#000000",
      },
      logo: null,
      version: 2,
      publishedAt: null,
      updatedAt: "2026-08-11T12:30:00.000Z",
    });

    expect(preview.source).toBe("draft_preview");
    expect(preview.footerText).toBe("Acme Ireland Limited");
    expect(
      organizationBrandingSchema.safeParse({
        ...preview,
        logoUrl: "https://storage.example.test/logo.webp",
      }).success,
    ).toBe(false);
  });

  it("resolves missing branding to the Sentinel fallback without a raw asset location", () => {
    const resolved = resolveOrganizationBranding(null);

    expect(organizationBrandingSchema.parse(CRA_SENTINEL_BRANDING)).toEqual(
      CRA_SENTINEL_BRANDING,
    );
    expect(resolved).toMatchObject({
      source: "sentinel",
      palette: CRA_SENTINEL_BRANDING.palette,
      logo: null,
    });
    expect(Object.keys(resolved)).not.toEqual(
      expect.arrayContaining(["storagePath", "url", "logoUrl"]),
    );
    expectTypeOf(resolveOrganizationBranding).returns.toEqualTypeOf<ResolvedOrganizationBranding>();
  });

  it("copies only resolved public branding fields", () => {
    const resolved = resolveOrganizationBranding({
      ...CRA_SENTINEL_BRANDING,
      storagePath: "private/organization-branding/logo.webp",
      url: "https://storage.example.test/private/organization-branding/logo.webp",
    });

    expect(Object.keys(resolved)).not.toEqual(
      expect.arrayContaining(["storagePath", "url", "logoUrl"]),
    );
  });
});
