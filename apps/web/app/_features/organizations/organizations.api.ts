import {
  createOrganizationInputSchema,
  currentOrganizationResponseSchema,
  deactivateOrganizationInputSchema,
  destructiveReauthenticationInputSchema,
  destructiveReauthenticationResponseSchema,
  exportAttachmentDownloadResponseSchema,
  exportRequestInputSchema,
  exportRequestResponseSchema,
  organizationExportParamsSchema,
  onboardingResponseSchema,
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
  updateOrganizationSettingsInputSchema,
  updateLegalProfileInputSchema,
  type DeactivateOrganizationInput,
  type CreateOrganizationInput,
  type DestructiveReauthenticationInput,
  type ExportRequestInput,
  type RecoverOrganizationInput,
  type RetentionPolicyUpdateInput,
  type ScheduleOrganizationPurgeInput,
  type UpdateOrganizationSettingsInput,
  type UpdateLegalProfileInput,
} from "@repo/contracts";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
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
