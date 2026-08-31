import {
  createLegalEntityInputSchema,
  createOrganizationInputSchema,
  currentOrganizationResponseSchema,
  legalEntitiesResponseSchema,
  legalEntityParamsSchema,
  legalEntityResponseSchema,
  legalEntityVersionInputSchema,
  deactivateOrganizationInputSchema,
  destructiveReauthenticationInputSchema,
  destructiveReauthenticationResponseSchema,
  exportAttachmentDownloadResponseSchema,
  exportRequestInputSchema,
  exportRequestResponseSchema,
  organizationExportParamsSchema,
  onboardingResponseSchema,
  organizationBrandingDraftResponseSchema,
  organizationBrandingResponseSchema,
  brandingLogoUploadFieldsSchema,
  publishOrganizationBrandingInputSchema,
  removeOrganizationBrandingInputSchema,
  organizationExportResponseSchema,
  latestOrganizationExportResponseSchema,
  organizationSchema,
  organizationSettingsCatalogResponseSchema,
  organizationSettingsResponseSchema,
  organizationLifecycleResponseSchema,
  recoverOrganizationInputSchema,
  retentionPolicyResponseSchema,
  retentionPolicyUpdateInputSchema,
  scheduleOrganizationPurgeInputSchema,
  switchOrganizationInputSchema,
  switchOrganizationResponseSchema,
  updateLegalEntityInputSchema,
  updateOrganizationBrandingDraftInputSchema,
  updateOrganizationSettingsInputSchema,
  updateLegalProfileInputSchema,
  type CreateLegalEntityInput,
  type BrandingLogoUploadFieldsInput,
  type DeactivateOrganizationInput,
  type CreateOrganizationInput,
  type DestructiveReauthenticationInput,
  type ExportRequestInput,
  type LegalEntityLifecycleInput,
  type PublishOrganizationBrandingInput,
  type RecoverOrganizationInput,
  type RemoveOrganizationBrandingInput,
  type RetentionPolicyUpdateInput,
  type ScheduleOrganizationPurgeInput,
  type UpdateLegalEntityInput,
  type UpdateOrganizationBrandingDraftInput,
  type UpdateOrganizationSettingsInput,
  type UpdateLegalProfileInput,
} from "@repo/contracts";

import {
  authenticatedRequestJson,
  authenticatedRequestMultipart,
} from "../../_lib/http/authenticated-request";
import { ApiClientError } from "../../_lib/http/api-client";

function exportPath(exportId: string, suffix = ""): `/${string}` {
  const parsed = organizationExportParamsSchema.safeParse({ exportId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The export identifier is invalid.",
      400,
    );
  }
  return `/api/v1/organizations/current/exports/${parsed.data.exportId}${suffix}`;
}

function entityPath(legalEntityId: string, suffix = ""): `/${string}` {
  const parsed = legalEntityParamsSchema.safeParse({ legalEntityId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The legal entity identifier is invalid.",
      400,
    );
  }
  return `/api/v1/organizations/current/legal-entities/${parsed.data.legalEntityId}${suffix}`;
}

function legalEntityActionPath(status: LegalEntityLifecycleInput["status"]) {
  if (status === "active") return "/activate";
  if (status === "inactive") return "/deactivate";
  return "/delete";
}

/** Typed browser boundary for the server-authoritative organization workflow. */
export class OrganizationsApi {
  create(input: CreateOrganizationInput, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations",
      method: "POST",
      body: input,
      inputSchema: createOrganizationInputSchema,
      signal,
      schema: organizationSchema,
    });
  }

  current(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/current",
      method: "GET",
      signal,
      schema: currentOrganizationResponseSchema,
    });
  }

  updateLegalProfile(input: UpdateLegalProfileInput, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/current/legal-profile",
      method: "PATCH",
      body: input,
      inputSchema: updateLegalProfileInputSchema,
      signal,
      schema: organizationSchema,
    });
  }

  legalEntities(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/current/legal-entities",
      method: "GET",
      signal,
      schema: legalEntitiesResponseSchema,
    });
  }

  createLegalEntity(input: CreateLegalEntityInput, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/current/legal-entities",
      method: "POST",
      body: input,
      inputSchema: createLegalEntityInputSchema,
      signal,
      schema: legalEntityResponseSchema,
    });
  }

  updateLegalEntity(
    legalEntityId: string,
    input: UpdateLegalEntityInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: entityPath(legalEntityId),
      method: "PATCH",
      body: input,
      inputSchema: updateLegalEntityInputSchema,
      signal,
      schema: legalEntityResponseSchema,
    });
  }

  transitionLegalEntity(
    legalEntityId: string,
    input: LegalEntityLifecycleInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: entityPath(legalEntityId, legalEntityActionPath(input.status)),
      method: "POST",
      body: { expectedVersion: input.expectedVersion },
      inputSchema: legalEntityVersionInputSchema,
      signal,
      schema: legalEntityResponseSchema,
    });
  }

  branding(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/current/branding",
      method: "GET",
      signal,
      schema: organizationBrandingResponseSchema,
    });
  }

  previewBranding(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/current/branding/preview",
      method: "GET",
      signal,
      schema: organizationBrandingResponseSchema,
    });
  }

  updateBrandingDraft(
    input: UpdateOrganizationBrandingDraftInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/current/branding",
      method: "PATCH",
      body: input,
      inputSchema: updateOrganizationBrandingDraftInputSchema,
      signal,
      schema: organizationBrandingDraftResponseSchema,
    });
  }

  uploadBrandingLogo(
    fields: BrandingLogoUploadFieldsInput,
    file: File,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestMultipart({
      path: "/api/v1/organizations/current/branding/logo",
      method: "POST",
      fields,
      fieldsSchema: brandingLogoUploadFieldsSchema,
      file: { name: "logo", value: file },
      signal,
      schema: organizationBrandingDraftResponseSchema,
    });
  }

  publishBranding(input: PublishOrganizationBrandingInput, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/current/branding/publish",
      method: "POST",
      body: input,
      inputSchema: publishOrganizationBrandingInputSchema,
      signal,
      schema: organizationBrandingResponseSchema,
    });
  }

  removeBrandingLogo(
    input: RemoveOrganizationBrandingInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/current/branding/logo",
      method: "DELETE",
      body: input,
      inputSchema: removeOrganizationBrandingInputSchema,
      signal,
      schema: organizationBrandingResponseSchema,
    });
  }

  switch(organizationId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/switch",
      method: "POST",
      body: { organizationId },
      inputSchema: switchOrganizationInputSchema,
      signal,
      schema: switchOrganizationResponseSchema,
    });
  }

  onboarding(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/current/onboarding",
      method: "GET",
      signal,
      schema: onboardingResponseSchema,
    });
  }

  settings(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/current/settings",
      method: "GET",
      signal,
      schema: organizationSettingsResponseSchema,
    });
  }

  settingsCatalog(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/current/settings/catalog",
      method: "GET",
      signal,
      schema: organizationSettingsCatalogResponseSchema,
    });
  }

  updateSettings(input: UpdateOrganizationSettingsInput, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/current/settings",
      method: "PATCH",
      body: input,
      inputSchema: updateOrganizationSettingsInputSchema,
      signal,
      schema: organizationSettingsResponseSchema,
    });
  }

  retention(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/current/retention",
      method: "GET",
      signal,
      schema: retentionPolicyResponseSchema,
    });
  }

  updateRetention(input: RetentionPolicyUpdateInput, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/current/retention",
      method: "PATCH",
      body: input,
      inputSchema: retentionPolicyUpdateInputSchema,
      signal,
      schema: retentionPolicyResponseSchema,
    });
  }

  requestExport(input: ExportRequestInput, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/current/exports",
      method: "POST",
      body: input,
      inputSchema: exportRequestInputSchema,
      signal,
      schema: exportRequestResponseSchema,
    });
  }

  exportStatus(exportId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: exportPath(exportId),
      method: "GET",
      signal,
      schema: organizationExportResponseSchema,
    });
  }

  latestExport(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/current/exports/latest",
      method: "GET",
      signal,
      schema: latestOrganizationExportResponseSchema,
    });
  }

  downloadExport(exportId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: exportPath(exportId, "/download"),
      method: "GET",
      signal,
      schema: exportAttachmentDownloadResponseSchema,
    });
  }

  lifecycle(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/current/lifecycle",
      method: "GET",
      signal,
      schema: organizationLifecycleResponseSchema,
    });
  }

  reauthenticate(
    input: DestructiveReauthenticationInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/current/lifecycle/reauthentication",
      method: "POST",
      body: input,
      inputSchema: destructiveReauthenticationInputSchema,
      signal,
      schema: destructiveReauthenticationResponseSchema,
    });
  }

  deactivate(input: DeactivateOrganizationInput, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/current/lifecycle/deactivate",
      method: "POST",
      body: input,
      inputSchema: deactivateOrganizationInputSchema,
      signal,
      schema: organizationLifecycleResponseSchema,
    });
  }

  schedulePurge(input: ScheduleOrganizationPurgeInput, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/current/lifecycle/purge",
      method: "POST",
      body: input,
      inputSchema: scheduleOrganizationPurgeInputSchema,
      signal,
      schema: organizationLifecycleResponseSchema,
    });
  }

  recover(input: RecoverOrganizationInput, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/current/lifecycle/recover",
      method: "POST",
      body: input,
      inputSchema: recoverOrganizationInputSchema,
      signal,
      schema: organizationLifecycleResponseSchema,
    });
  }
}

export const organizationsApi = Object.freeze(new OrganizationsApi());
