import { idempotencyKeySchema } from "./organization-input.schema.js";
import { z } from "zod";

/** Private source images are constrained before inspection and normalization. */
export const BRANDING_MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const BRANDING_MIN_LOGO_DIMENSION_PIXELS = 64;
export const BRANDING_MAX_LOGO_DIMENSION_PIXELS = 2048;
export const BRANDING_MAX_LOGO_PIXELS = 16_000_000;
export const BRANDING_MIN_CONTRAST_RATIO = 4.5;

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const BLACK = "#000000";
const WHITE = "#FFFFFF";

export const hexColorSchema = z
  .string()
  .trim()
  .regex(HEX_COLOR_PATTERN, "Use a six-digit hexadecimal color")
  .transform((color) => color.toUpperCase());

type HexColor = z.output<typeof hexColorSchema>;
type BrandTextColor = typeof BLACK | typeof WHITE;

function relativeLuminance(color: HexColor): number {
  const linearize = (channel: number) =>
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  const red = linearize(Number.parseInt(color.slice(1, 3), 16) / 255);
  const green = linearize(Number.parseInt(color.slice(3, 5), 16) / 255);
  const blue = linearize(Number.parseInt(color.slice(5, 7), 16) / 255);

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG contrast ratio for canonical six-digit hexadecimal colors. */
export function contrastRatio(
  firstColor: HexColor,
  secondColor: HexColor,
): number {
  const firstLuminance = relativeLuminance(firstColor);
  const secondLuminance = relativeLuminance(secondColor);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

/** Chooses the accessible black-or-white foreground for one trusted color. */
export function resolveTextColor(backgroundColor: HexColor): Readonly<{
  color: BrandTextColor;
  contrastRatio: number;
}> {
  const blackContrastRatio = contrastRatio(BLACK, backgroundColor);
  const whiteContrastRatio = contrastRatio(WHITE, backgroundColor);
  const isBlackMoreReadable = blackContrastRatio >= whiteContrastRatio;

  return Object.freeze({
    color: isBlackMoreReadable ? BLACK : WHITE,
    contrastRatio: isBlackMoreReadable
      ? blackContrastRatio
      : whiteContrastRatio,
  });
}

export const organizationBrandingPaletteInputSchema = z
  .object({
    primary: hexColorSchema,
    secondary: hexColorSchema,
  })
  .strict();

export const organizationBrandingPaletteSchema = z
  .object({
    primary: hexColorSchema,
    primaryText: z.literal([BLACK, WHITE]),
    secondary: hexColorSchema,
    secondaryText: z.literal([BLACK, WHITE]),
  })
  .strict()
  .superRefine((palette, context) => {
    const primary = resolveTextColor(palette.primary);
    const secondary = resolveTextColor(palette.secondary);

    if (
      palette.primaryText !== primary.color ||
      primary.contrastRatio < BRANDING_MIN_CONTRAST_RATIO
    ) {
      context.addIssue({
        code: "custom",
        message: "Primary text color must meet WCAG AA contrast",
        path: ["primaryText"],
      });
    }
    if (
      palette.secondaryText !== secondary.color ||
      secondary.contrastRatio < BRANDING_MIN_CONTRAST_RATIO
    ) {
      context.addIssue({
        code: "custom",
        message: "Secondary text color must meet WCAG AA contrast",
        path: ["secondaryText"],
      });
    }
  });

export const organizationBrandingLogoSchema = z
  .object({
    assetId: z.uuid(),
    width: z
      .number()
      .int()
      .min(BRANDING_MIN_LOGO_DIMENSION_PIXELS)
      .max(BRANDING_MAX_LOGO_DIMENSION_PIXELS),
    height: z
      .number()
      .int()
      .min(BRANDING_MIN_LOGO_DIMENSION_PIXELS)
      .max(BRANDING_MAX_LOGO_DIMENSION_PIXELS),
    mimeType: z.literal("image/webp"),
    sha256: z.string().regex(/^[a-f0-9]{64}$/, "Use a lowercase SHA-256"),
    altText: z.string().trim().min(1).max(160).nullable(),
  })
  .strict()
  .superRefine((logo, context) => {
    if (logo.width * logo.height > BRANDING_MAX_LOGO_PIXELS) {
      context.addIssue({
        code: "custom",
        message: "Logo dimensions exceed the decoded pixel limit",
      });
    }
  });

export const organizationBrandingSourceSchema = z.enum([
  "sentinel",
  "draft_preview",
  "published",
]);

const safeBrandingTextSchema = z.string().trim().min(1).max(280).nullable();

const resolvedOrganizationBrandingSnapshotFieldsSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200),
    footerText: safeBrandingTextSchema.default(null),
    contactText: safeBrandingTextSchema.default(null),
    palette: organizationBrandingPaletteSchema,
    logo: organizationBrandingLogoSchema.nullable(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const sentinelOrganizationBrandingSnapshotSchema =
  resolvedOrganizationBrandingSnapshotFieldsSchema.extend({
    source: z.literal("sentinel"),
    logo: z.null(),
    version: z.literal(0),
    publishedAt: z.null(),
  });

const draftPreviewOrganizationBrandingSnapshotSchema =
  resolvedOrganizationBrandingSnapshotFieldsSchema.extend({
    source: z.literal("draft_preview"),
    version: z.number().int().nonnegative(),
    publishedAt: z.null(),
  });

const publishedOrganizationBrandingSnapshotSchema =
  resolvedOrganizationBrandingSnapshotFieldsSchema.extend({
    source: z.literal("published"),
    version: z.number().int().positive(),
    publishedAt: z.iso.datetime({ offset: true }),
  });

/** The only portal/document-facing branding shape; it is storage-location free. */
export const resolvedOrganizationBrandingSnapshotSchema = z.discriminatedUnion(
  "source",
  [
    sentinelOrganizationBrandingSnapshotSchema,
    draftPreviewOrganizationBrandingSnapshotSchema,
    publishedOrganizationBrandingSnapshotSchema,
  ],
);

/** Compatibility export for existing organization branding consumers. */
export const organizationBrandingSchema =
  resolvedOrganizationBrandingSnapshotSchema;

export const organizationBrandingDraftLogoAssetSchema = z.discriminatedUnion(
  "status",
  [
    z.object({ status: z.literal("none"), asset: z.null() }).strict(),
    z
      .object({
        status: z.literal("approved"),
        asset: organizationBrandingLogoSchema,
      })
      .strict(),
  ],
);

/** Mutable owner-only draft. Only an approved asset can be selected into it. */
export const organizationBrandingDraftSchema = z
  .object({
    id: z.uuid(),
    displayName: z.string().trim().min(1).max(200),
    palette: organizationBrandingPaletteInputSchema,
    footerText: safeBrandingTextSchema,
    contactText: safeBrandingTextSchema,
    logoAsset: organizationBrandingDraftLogoAssetSchema,
    version: z.number().int().nonnegative(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    createdBy: z.uuid(),
    updatedBy: z.uuid(),
  })
  .strict();

const sentinelPalette = Object.freeze({
  primary: "#0167FF",
  primaryText: WHITE,
  secondary: "#00A39B",
  secondaryText: BLACK,
});

/** Immutable, storage-free branding used when an organization has no publication. */
export const CRA_SENTINEL_BRANDING = Object.freeze({
  source: "sentinel" as const,
  displayName: "CRA Sentinel",
  footerText: "CRA Sentinel",
  contactText: null,
  palette: sentinelPalette,
  logo: null,
  version: 0,
  publishedAt: null,
  updatedAt: "1970-01-01T00:00:00.000Z",
});

export const updateOrganizationBrandingDraftInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    displayName: z.string().trim().min(1).max(200),
    palette: organizationBrandingPaletteInputSchema,
    footerText: safeBrandingTextSchema.optional(),
    contactText: safeBrandingTextSchema.optional(),
    logoAssetId: z.uuid().nullable(),
  })
  .strict();

/** Parsed non-file fields accepted alongside the inspected private logo upload. */
export const brandingLogoUploadFieldsSchema = z
  .object({
    altText: z.string().trim().min(1).max(160).optional(),
  })
  .strict()
  .transform((value) => ({ altText: value.altText ?? null }));

export const publishOrganizationBrandingInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const removeOrganizationBrandingInputSchema =
  publishOrganizationBrandingInputSchema;

export const organizationBrandingResponseSchema = z
  .object({ branding: resolvedOrganizationBrandingSnapshotSchema })
  .strict();

export const organizationBrandingDraftResponseSchema = z
  .object({ draft: organizationBrandingDraftSchema })
  .strict();

/**
 * Resolves a public branding value without leaking bucket names, storage paths,
 * object keys, signed URLs, or provider-specific locations.
 */
export function resolveOrganizationBranding(
  branding: z.output<typeof resolvedOrganizationBrandingSnapshotSchema> | null,
): z.output<typeof resolvedOrganizationBrandingSnapshotSchema> {
  const resolved = branding ?? CRA_SENTINEL_BRANDING;

  return Object.freeze(resolvedOrganizationBrandingSnapshotSchema.parse({
    source: resolved.source,
    displayName: resolved.displayName,
    footerText: resolved.footerText,
    contactText: resolved.contactText,
    palette: Object.freeze({
      primary: resolved.palette.primary,
      primaryText: resolved.palette.primaryText,
      secondary: resolved.palette.secondary,
      secondaryText: resolved.palette.secondaryText,
    }),
    logo:
      resolved.logo === null
        ? null
        : Object.freeze({
            assetId: resolved.logo.assetId,
            width: resolved.logo.width,
            height: resolved.logo.height,
            mimeType: resolved.logo.mimeType,
            sha256: resolved.logo.sha256,
            altText: resolved.logo.altText,
          }),
    version: resolved.version,
    publishedAt: resolved.publishedAt,
    updatedAt: resolved.updatedAt,
  }));
}
