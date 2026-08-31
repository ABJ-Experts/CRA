import type { z } from "zod";

import type {
  brandingLogoUploadFieldsSchema,
  hexColorSchema,
  organizationBrandingLogoSchema,
  organizationBrandingDraftLogoAssetSchema,
  organizationBrandingDraftResponseSchema,
  organizationBrandingDraftSchema,
  organizationBrandingPaletteInputSchema,
  organizationBrandingPaletteSchema,
  organizationBrandingResponseSchema,
  organizationBrandingSchema,
  organizationBrandingSourceSchema,
  publishOrganizationBrandingInputSchema,
  removeOrganizationBrandingInputSchema,
  updateOrganizationBrandingDraftInputSchema,
  resolvedOrganizationBrandingSnapshotSchema,
} from "../schemas/index.js";

/** Unparsed fields supplied by the browser multipart transport. */
export type BrandingLogoUploadFieldsInput = z.input<
  typeof brandingLogoUploadFieldsSchema
>;
/** Trusted upload fields after the controller parses the multipart form values. */
export type BrandingLogoUploadFields = z.output<
  typeof brandingLogoUploadFieldsSchema
>;
export type HexColor = z.output<typeof hexColorSchema>;
export type OrganizationBrandingPaletteInput = z.output<
  typeof organizationBrandingPaletteInputSchema
>;
export type OrganizationBrandingPalette = z.output<
  typeof organizationBrandingPaletteSchema
>;
export type OrganizationBrandingLogo = z.output<
  typeof organizationBrandingLogoSchema
>;
export type OrganizationBrandingDraftLogoAsset = z.output<
  typeof organizationBrandingDraftLogoAssetSchema
>;
export type OrganizationBrandingDraft = z.output<
  typeof organizationBrandingDraftSchema
>;
export type OrganizationBrandingSource = z.output<
  typeof organizationBrandingSourceSchema
>;
export type OrganizationBranding = z.output<typeof organizationBrandingSchema>;
export type ResolvedOrganizationBranding = z.output<
  typeof resolvedOrganizationBrandingSnapshotSchema
>;
export type OrganizationBrandingResponse = z.output<
  typeof organizationBrandingResponseSchema
>;
export type OrganizationBrandingDraftResponse = z.output<
  typeof organizationBrandingDraftResponseSchema
>;
export type UpdateOrganizationBrandingDraftInput = z.output<
  typeof updateOrganizationBrandingDraftInputSchema
>;
export type PublishOrganizationBrandingInput = z.output<
  typeof publishOrganizationBrandingInputSchema
>;
export type RemoveOrganizationBrandingInput = z.output<
  typeof removeOrganizationBrandingInputSchema
>;
