import type {
  CreateLegalEntityInput,
  CreateOrganizationInput,
  DeactivateOrganizationInput,
  DestructiveReauthenticationInput,
  ExportRequestInput,
  LegalEntityLifecycleInput,
  LatestOrganizationExportResponse,
  OrganizationExportResponse,
  PublishOrganizationBrandingInput,
  RecoverOrganizationInput,
  RemoveOrganizationBrandingInput,
  RetentionPolicyUpdateInput,
  ScheduleOrganizationPurgeInput,
  UpdateLegalEntityInput,
  UpdateOrganizationBrandingDraftInput,
  UpdateOrganizationSettingsInput,
  UpdateLegalProfileInput,
} from "@repo/contracts";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { sessionKeys } from "../session/session.keys";
import { organizationsApi } from "./organizations.api";
import { organizationKeys } from "./organizations.keys";

/** Progress is server-authoritative, so avoid showing a stale wizard stage. */
export const ORGANIZATIONS_STALE_TIME_MS = 30_000;

export function organizationCurrentQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: organizationKeys.current,
    enabled,
    retry: false,
    staleTime: ORGANIZATIONS_STALE_TIME_MS,
    queryFn: ({ signal }) => organizationsApi.current(signal),
  });
}

export function organizationOnboardingQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: organizationKeys.onboarding,
    enabled,
    retry: false,
    staleTime: ORGANIZATIONS_STALE_TIME_MS,
    queryFn: ({ signal }) => organizationsApi.onboarding(signal),
  });
}

export function organizationSettingsQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: organizationKeys.settings,
    enabled,
    retry: false,
    staleTime: ORGANIZATIONS_STALE_TIME_MS,
    queryFn: ({ signal }) => organizationsApi.settings(signal),
  });
}

export function organizationSettingsCatalogQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: organizationKeys.settingsCatalog,
    enabled,
    retry: false,
    staleTime: ORGANIZATIONS_STALE_TIME_MS,
    queryFn: ({ signal }) => organizationsApi.settingsCatalog(signal),
  });
}

export function organizationRetentionQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: organizationKeys.retention,
    enabled,
    retry: false,
    staleTime: ORGANIZATIONS_STALE_TIME_MS,
    queryFn: ({ signal }) => organizationsApi.retention(signal),
  });
}

export function organizationLifecycleQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: organizationKeys.lifecycle,
    enabled,
    retry: false,
    staleTime: ORGANIZATIONS_STALE_TIME_MS,
    queryFn: ({ signal }) => organizationsApi.lifecycle(signal),
  });
}

export function organizationLegalEntitiesQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: organizationKeys.legalEntities,
    enabled,
    retry: false,
    staleTime: ORGANIZATIONS_STALE_TIME_MS,
    queryFn: ({ signal }) => organizationsApi.legalEntities(signal),
  });
}

export function organizationBrandingQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: organizationKeys.branding,
    enabled,
    retry: false,
    staleTime: ORGANIZATIONS_STALE_TIME_MS,
    queryFn: ({ signal }) => organizationsApi.branding(signal),
  });
}

export function organizationBrandingPreviewQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: organizationKeys.brandingPreview,
    enabled,
    retry: false,
    staleTime: ORGANIZATIONS_STALE_TIME_MS,
    queryFn: ({ signal }) => organizationsApi.previewBranding(signal),
  });
}

function shouldPollExport(
  status: OrganizationExportResponse["export"]["status"] | undefined,
) {
  return status === "queued" || status === "running";
}

export function organizationExportQueryOptions(
  exportId: string | null,
  enabled: boolean,
) {
  return queryOptions<OrganizationExportResponse>({
    queryKey:
      exportId === null
        ? organizationKeys.exports
        : organizationKeys.exportStatus(exportId),
    enabled: enabled && exportId !== null,
    retry: false,
    staleTime: 0,
    refetchInterval: (query) => {
      const data = query.state.data as OrganizationExportResponse | undefined;
      return shouldPollExport(data?.export.status) ? 5_000 : false;
    },
    queryFn: ({ signal }) => {
      if (exportId === null) {
        throw new Error("An export identifier is required to check export status.");
      }
      return organizationsApi.exportStatus(exportId, signal);
    },
  });
}

export function latestOrganizationExportQueryOptions(enabled: boolean) {
  return queryOptions<LatestOrganizationExportResponse>({
    queryKey: organizationKeys.latestExport,
    enabled,
    retry: false,
    staleTime: 0,
    queryFn: ({ signal }) => organizationsApi.latestExport(signal),
  });
}

export function useCurrentOrganizationQuery(enabled: boolean) {
  return useQuery(organizationCurrentQueryOptions(enabled));
}

export function useOnboardingQuery(enabled: boolean) {
  return useQuery(organizationOnboardingQueryOptions(enabled));
}

export function useOrganizationSettingsQuery(enabled: boolean) {
  return useQuery(organizationSettingsQueryOptions(enabled));
}

export function useOrganizationSettingsCatalogQuery(enabled: boolean) {
  return useQuery(organizationSettingsCatalogQueryOptions(enabled));
}

export function useOrganizationRetentionQuery(enabled: boolean) {
  return useQuery(organizationRetentionQueryOptions(enabled));
}

export function useOrganizationLifecycleQuery(enabled: boolean) {
  return useQuery(organizationLifecycleQueryOptions(enabled));
}

export function useLegalEntitiesQuery(enabled: boolean) {
  return useQuery(organizationLegalEntitiesQueryOptions(enabled));
}

export function useOrganizationBrandingQuery(enabled: boolean) {
  return useQuery(organizationBrandingQueryOptions(enabled));
}

export function useOrganizationBrandingPreviewQuery(enabled: boolean) {
  return useQuery(organizationBrandingPreviewQueryOptions(enabled));
}

export function useOrganizationExportQuery(
  exportId: string | null,
  enabled: boolean,
) {
  return useQuery(organizationExportQueryOptions(exportId, enabled));
}

export function useLatestOrganizationExportQuery(enabled: boolean) {
  return useQuery(latestOrganizationExportQueryOptions(enabled));
}

function useInvalidateOrganizationState() {
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: sessionKeys.all }),
      queryClient.invalidateQueries({ queryKey: organizationKeys.all }),
    ]);
  };
}

function useInvalidateTenantAdministrationState(
  ...keys: readonly (readonly string[])[]
) {
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: sessionKeys.all }),
      ...keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    ]);
  };
}

export function useCreateOrganizationMutation() {
  const invalidateOrganizationState = useInvalidateOrganizationState();

  return useMutation({
    mutationFn: (input: CreateOrganizationInput) =>
      organizationsApi.create(input),
    onSuccess: invalidateOrganizationState,
  });
}

export function useSwitchOrganizationMutation() {
  const invalidateOrganizationState = useInvalidateOrganizationState();

  return useMutation({
    mutationFn: (organizationId: string) =>
      organizationsApi.switch(organizationId),
    onSuccess: invalidateOrganizationState,
  });
}

export function useUpdateLegalProfileMutation() {
  const invalidateOrganizationState = useInvalidateOrganizationState();

  return useMutation({
    mutationFn: (input: UpdateLegalProfileInput) =>
      organizationsApi.updateLegalProfile(input),
    onSuccess: invalidateOrganizationState,
  });
}

function useInvalidateLegalEntitiesState() {
  return useInvalidateTenantAdministrationState(organizationKeys.legalEntities);
}

function useInvalidateBrandingState() {
  return useInvalidateTenantAdministrationState(
    organizationKeys.branding,
    organizationKeys.brandingPreview,
  );
}

export function useCreateLegalEntityMutation() {
  const invalidateLegalEntitiesState = useInvalidateLegalEntitiesState();

  return useMutation({
    mutationFn: (input: CreateLegalEntityInput) =>
      organizationsApi.createLegalEntity(input),
    onSuccess: invalidateLegalEntitiesState,
  });
}

export function useUpdateLegalEntityMutation() {
  const invalidateLegalEntitiesState = useInvalidateLegalEntitiesState();

  return useMutation({
    mutationFn: ({
      legalEntityId,
      input,
    }: {
      legalEntityId: string;
      input: UpdateLegalEntityInput;
    }) => organizationsApi.updateLegalEntity(legalEntityId, input),
    onSuccess: invalidateLegalEntitiesState,
  });
}

export function useTransitionLegalEntityMutation() {
  const invalidateLegalEntitiesState = useInvalidateLegalEntitiesState();

  return useMutation({
    mutationFn: ({
      legalEntityId,
      input,
    }: {
      legalEntityId: string;
      input: LegalEntityLifecycleInput;
    }) => organizationsApi.transitionLegalEntity(legalEntityId, input),
    onSuccess: invalidateLegalEntitiesState,
  });
}

export function useUpdateBrandingDraftMutation() {
  const invalidateBrandingState = useInvalidateBrandingState();

  return useMutation({
    mutationFn: (input: UpdateOrganizationBrandingDraftInput) =>
      organizationsApi.updateBrandingDraft(input),
    onSuccess: invalidateBrandingState,
  });
}

export function useBrandingLogoUploadMutation() {
  const invalidateBrandingState = useInvalidateBrandingState();

  return useMutation({
    mutationFn: ({
      fields,
      file,
    }: {
      fields: Parameters<typeof organizationsApi.uploadBrandingLogo>[0];
      file: File;
    }) => organizationsApi.uploadBrandingLogo(fields, file),
    onSuccess: invalidateBrandingState,
  });
}

export function useBrandingPublishMutation() {
  const invalidateBrandingState = useInvalidateBrandingState();

  return useMutation({
    mutationFn: (input: PublishOrganizationBrandingInput) =>
      organizationsApi.publishBranding(input),
    onSuccess: invalidateBrandingState,
  });
}

export function useBrandingLogoRemoveMutation() {
  const invalidateBrandingState = useInvalidateBrandingState();

  return useMutation({
    mutationFn: (input: RemoveOrganizationBrandingInput) =>
      organizationsApi.removeBrandingLogo(input),
    onSuccess: invalidateBrandingState,
  });
}

export function useUpdateOrganizationSettingsMutation() {
  const invalidateTenantAdministrationState =
    useInvalidateTenantAdministrationState(organizationKeys.settings);

  return useMutation({
    mutationFn: (input: UpdateOrganizationSettingsInput) =>
      organizationsApi.updateSettings(input),
    onSuccess: invalidateTenantAdministrationState,
  });
}

export function useUpdateRetentionMutation() {
  const invalidateTenantAdministrationState =
    useInvalidateTenantAdministrationState(organizationKeys.retention);

  return useMutation({
    mutationFn: (input: RetentionPolicyUpdateInput) =>
      organizationsApi.updateRetention(input),
    onSuccess: invalidateTenantAdministrationState,
  });
}

export function useRequestExportMutation() {
  const invalidateTenantAdministrationState =
    useInvalidateTenantAdministrationState(organizationKeys.exports);

  return useMutation({
    mutationFn: (input: ExportRequestInput) =>
      organizationsApi.requestExport(input),
    onSuccess: invalidateTenantAdministrationState,
  });
}

export function useDownloadOrganizationExportMutation() {
  return useMutation({
    mutationFn: (exportId: string) => organizationsApi.downloadExport(exportId),
  });
}

export function useReauthenticateOrganizationMutation() {
  return useMutation({
    mutationFn: (input: DestructiveReauthenticationInput) =>
      organizationsApi.reauthenticate(input),
  });
}

export function useDeactivateOrganizationMutation() {
  const invalidateOrganizationState = useInvalidateOrganizationState();

  return useMutation({
    mutationFn: (input: DeactivateOrganizationInput) =>
      organizationsApi.deactivate(input),
    onSuccess: invalidateOrganizationState,
  });
}

export function useScheduleOrganizationPurgeMutation() {
  const invalidateOrganizationState = useInvalidateOrganizationState();

  return useMutation({
    mutationFn: (input: ScheduleOrganizationPurgeInput) =>
      organizationsApi.schedulePurge(input),
    onSuccess: invalidateOrganizationState,
  });
}

export function useRecoverOrganizationMutation() {
  const invalidateOrganizationState = useInvalidateOrganizationState();

  return useMutation({
    mutationFn: (input: RecoverOrganizationInput) => organizationsApi.recover(input),
    onSuccess: invalidateOrganizationState,
  });
}
