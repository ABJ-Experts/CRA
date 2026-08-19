"use client";

import type {
  AddReleaseMarketAvailabilityInput,
  ArchiveProductInput,
  ArchiveReleaseInput,
  ArchiveSoftwareBaselineInput,
  AppendSoftwareBaselineRevisionInput,
  AssignSoftwareBaselineMembershipInput,
  CreateProductComponentLinkInput,
  CreateSubstantialModificationAssessmentDraftInput,
  CreateSubstantialModificationAssessmentInput,
  CreateProductVariantRelationshipInput,
  CorrectPlacedOnMarketDateInput,
  CorrectReleaseMarketAvailabilityInput,
  CreateProductInput,
  CreateReleaseInput,
  CreateSoftwareBaselineInput,
  EndProductComponentLinkInput,
  EndProductVariantRelationshipInput,
  EndSoftwareBaselineMembershipInput,
  FinalizeSecurityUpdateArtifactInput,
  CreateSupportPeriodRequest,
  MoveProductLegalEntityInput,
  ProductListQuery,
  ProductImportCancelInput,
  ProductImportCommitInput,
  ProductImportListQuery,
  ProductImportResponse,
  ProductImportRowsResponse,
  ProductImportRowsQuery,
  ProductImportsResponse,
  ProductImportTemplateResponse,
  ProductImportUploadFields,
  ProductRelationshipGraphQuery,
  PublishSecurityUpdateArtifactInput,
  PreviewProductComponentLinkInput,
  RequestRelationshipReevaluationInput,
  ReleaseListQuery,
  ReassessSubstantialModificationAssessmentInput,
  ReplaceSecurityUpdateArtifactInput,
  ReserveSecurityUpdateArtifactInput,
  ReviewSecurityUpdateArtifactInput,
  ReviewSubstantialModificationAssessmentInput,
  UpdateSecurityUpdateArtifactMetadataInput,
  RelationshipPropagationEventsQuery,
  SoftwareBaselineListQuery,
  SecurityUpdateArtifactListQuery,
  SubstantialModificationAssessmentListQuery,
  RemoveReleaseMarketAvailabilityInput,
  SupersedeSupportPeriodRequest,
  SupersedeProductComponentLinkInput,
  PreviewSupportPeriodChangeRequest,
  TransitionReleaseLifecycleInput,
  UpdateSupportAlertIntervalsRequest,
  UpdateProductInput,
  UpdateReleaseInput,
  WithdrawSecurityUpdateArtifactInput,
} from "@repo/contracts/products";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { productKeys } from "./products.keys";
import { productsApi } from "./products.api";

function listKey(query: Record<string, unknown>): string {
  return JSON.stringify(
    Object.entries(query).filter(([, value]) => value !== undefined),
  );
}

export function useProductsQuery(
  query: Partial<ProductListQuery>,
  enabled: boolean,
) {
  return useQuery({
    queryKey: productKeys.list(listKey(query)),
    enabled,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => productsApi.list(query, signal),
  });
}

function shouldPollImport(status: string | undefined): boolean {
  return (
    status === "queued" ||
    status === "parsing" ||
    status === "validating" ||
    status === "committing" ||
    status === "retrying"
  );
}

export function useProductImportQuery(importId: string, enabled: boolean) {
  return useQuery<ProductImportResponse>({
    queryKey: productKeys.importDetail(importId),
    enabled: enabled && importId !== "",
    retry: false,
    refetchInterval: (query) =>
      shouldPollImport(query.state.data?.import.status) ? 2_000 : false,
    queryFn: ({ signal }) => productsApi.getImport(importId, signal),
  });
}

export function useProductImportRowsQuery(
  importId: string,
  query: Partial<ProductImportRowsQuery>,
  enabled: boolean,
) {
  return useQuery<ProductImportRowsResponse>({
    queryKey: productKeys.importRows(importId, listKey(query)),
    enabled: enabled && importId !== "",
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      productsApi.listImportRows(importId, query, signal),
  });
}

export function useProductImportTemplateQuery(enabled: boolean) {
  return useQuery<ProductImportTemplateResponse>({
    queryKey: [...productKeys.imports, "template"],
    enabled,
    retry: false,
    staleTime: Infinity,
    queryFn: ({ signal }) => productsApi.getImportTemplate(signal),
  });
}

export function useProductImportsQuery(
  query: Partial<ProductImportListQuery>,
  enabled: boolean,
) {
  return useQuery<ProductImportsResponse>({
    queryKey: [...productKeys.imports, listKey(query)],
    enabled,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => productsApi.listImports(query, signal),
  });
}

export function useUploadProductImportMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      fields,
      file,
    }: {
      fields: ProductImportUploadFields;
      file: File;
    }) => productsApi.uploadImport(fields, file),
    onSuccess: (response) => {
      void queryClient.invalidateQueries({
        queryKey: productKeys.importDetail(response.import.id),
      });
      void queryClient.invalidateQueries({ queryKey: productKeys.imports });
    },
  });
}

export function useCommitProductImportMutation(importId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductImportCommitInput) =>
      productsApi.commitImport(importId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: productKeys.importDetail(importId),
      });
      void queryClient.invalidateQueries({ queryKey: productKeys.imports });
      void queryClient.invalidateQueries({ queryKey: productKeys.lists });
    },
  });
}

export function useCancelProductImportMutation(importId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductImportCancelInput) =>
      productsApi.cancelImport(importId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: productKeys.importDetail(importId),
      });
      void queryClient.invalidateQueries({ queryKey: productKeys.imports });
    },
  });
}

export function useProductImportReportMutation(importId: string) {
  return useMutation({
    mutationFn: () => productsApi.getImportReportLink(importId),
  });
}

export function useProductQuery(productId: string, enabled: boolean) {
  return useQuery({
    queryKey: productKeys.detail(productId),
    enabled,
    retry: false,
    queryFn: ({ signal }) => productsApi.get(productId, signal),
  });
}

export function useProductReleasesQuery(
  productId: string,
  query: {
    archived?: boolean;
    page?: number;
    pageSize?: number;
    lifecycle?: ReleaseListQuery["lifecycle"];
  },
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...productKeys.releases(productId), listKey(query)],
    enabled,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => productsApi.listReleases(productId, query, signal),
  });
}

export function useSubstantialModificationAssessmentsQuery(
  productId: string,
  query: Partial<SubstantialModificationAssessmentListQuery>,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [
      ...productKeys.modificationAssessments(productId),
      listKey(query),
    ],
    enabled: enabled && productId !== "",
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      productsApi.listSubstantialModificationAssessments(
        productId,
        query,
        signal,
      ),
  });
}

/**
 * The list endpoint already returns every status — including `superseded` —
 * when no `status` filter is passed, so the full revision chain for one
 * modification is just a client-side filter over a wide-enough page.
 * ponytail: caps at 100 rows product-wide; paginate if a chain outgrows that.
 */
export function useSubstantialModificationAssessmentHistoryQuery(
  productId: string,
  modificationId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [
      ...productKeys.modificationAssessments(productId),
      "history",
      modificationId,
    ],
    enabled: enabled && productId !== "" && modificationId !== "",
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await productsApi.listSubstantialModificationAssessments(
        productId,
        { pageSize: 100 },
        signal,
      );
      return response.assessments.rows
        .filter((row) => row.modificationId === modificationId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
  });
}

export function useSecurityUpdateArtifactsQuery(
  productId: string,
  query: Partial<SecurityUpdateArtifactListQuery>,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [
      ...productKeys.securityUpdateArtifacts(productId),
      listKey(query),
    ],
    enabled: enabled && productId !== "",
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      productsApi.listSecurityUpdateArtifacts(productId, query, signal),
  });
}

export function useMemberStatesQuery(enabled: boolean) {
  return useQuery({
    queryKey: productKeys.memberStates,
    enabled,
    retry: false,
    queryFn: ({ signal }) => productsApi.listMemberStates(signal),
  });
}

export function useReleaseMarketAvailabilityQuery(
  productId: string,
  releaseId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: productKeys.marketAvailability(productId, releaseId),
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      productsApi.getReleaseMarketAvailability(productId, releaseId, signal),
  });
}

export function useReleaseLifecycleTimelineQuery(
  productId: string,
  releaseId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: productKeys.lifecycleTimeline(productId, releaseId),
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      productsApi.getReleaseLifecycleTimeline(productId, releaseId, signal),
  });
}

export function useSupportPeriodHistoryQuery(
  productId: string,
  releaseId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: productKeys.supportPeriods(productId, releaseId),
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      productsApi.listSupportPeriods(productId, releaseId, signal),
  });
}

export function useSupportPeriodRetentionQuery(
  productId: string,
  releaseId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: productKeys.supportRetention(productId, releaseId),
    enabled,
    retry: false,
    queryFn: ({ signal }) => productsApi.getSupportRetention(productId, signal),
  });
}

export function useSupportAlertsQuery(
  productId: string,
  releaseId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: productKeys.supportAlerts(productId, releaseId),
    enabled,
    retry: false,
    queryFn: ({ signal }) => productsApi.getSupportAlerts(productId, signal),
  });
}

export function useSupportAlertIntervalsQuery(enabled: boolean) {
  return useQuery({
    queryKey: productKeys.supportAlertIntervals,
    enabled,
    retry: false,
    queryFn: ({ signal }) => productsApi.getSupportAlertIntervals(signal),
  });
}

export function useSoftwareBaselineRevisionsQuery(
  baselineId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: productKeys.baselineRevisions(baselineId),
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      productsApi.listSoftwareBaselineRevisions(baselineId, signal),
  });
}

export function useSoftwareBaselinesQuery(
  query: Partial<SoftwareBaselineListQuery>,
  enabled: boolean,
) {
  return useQuery({
    queryKey: productKeys.baselineList(listKey(query)),
    enabled,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => productsApi.listSoftwareBaselines(query, signal),
  });
}

export function useSoftwareBaselineMembershipsQuery(
  productId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: productKeys.baselineMemberships(productId),
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      productsApi.listSoftwareBaselineMemberships(productId, signal),
  });
}

export function useProductVariantRelationshipsQuery(
  productId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: productKeys.variantRelationships(productId),
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      productsApi.listProductVariantRelationships(productId, signal),
  });
}

export function useProductComponentLinksQuery(
  productId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: productKeys.componentLinks(productId),
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      productsApi.listProductComponentLinks(productId, signal),
  });
}

export function useProductRelationshipGraphQuery(
  productId: string,
  enabled: boolean,
  query: Partial<ProductRelationshipGraphQuery> = {},
) {
  return useQuery({
    queryKey: [...productKeys.relationshipGraph(productId), listKey(query)],
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      productsApi.getProductRelationshipGraph(productId, query, signal),
  });
}

export function useRelationshipPropagationEventsQuery(
  productId: string,
  enabled: boolean,
  query: Partial<RelationshipPropagationEventsQuery> = {},
) {
  return useQuery({
    queryKey: [
      ...productKeys.relationshipPropagationEvents(productId),
      listKey(query),
    ],
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      productsApi.listRelationshipPropagationEvents(productId, query, signal),
  });
}

function useInvalidateProducts() {
  const client = useQueryClient();
  return async (
    productId?: string,
    releaseId?: string,
    options: Readonly<{ support?: boolean; relationships?: boolean }> = {},
  ) => {
    await Promise.all([
      client.invalidateQueries({ queryKey: productKeys.all }),
      ...(productId
        ? [
            client.invalidateQueries({
              queryKey: productKeys.detail(productId),
            }),
            client.invalidateQueries({
              queryKey: productKeys.releases(productId),
            }),
            ...(options.support
              ? [
                  client.invalidateQueries({
                    queryKey: productKeys.supportPeriods(productId),
                  }),
                  client.invalidateQueries({
                    queryKey: productKeys.supportRetention(productId),
                  }),
                  client.invalidateQueries({
                    queryKey: productKeys.supportAlerts(productId),
                  }),
                ]
              : []),
            ...(options.relationships
              ? [
                  client.invalidateQueries({
                    queryKey: productKeys.baselineMemberships(productId),
                  }),
                  client.invalidateQueries({
                    queryKey: productKeys.variantRelationships(productId),
                  }),
                  client.invalidateQueries({
                    queryKey: productKeys.componentLinks(productId),
                  }),
                  client.invalidateQueries({
                    queryKey: productKeys.relationshipGraph(productId),
                  }),
                  client.invalidateQueries({
                    queryKey:
                      productKeys.relationshipPropagationEvents(productId),
                  }),
                ]
              : []),
          ]
        : []),
      ...(productId && releaseId
        ? [
            client.invalidateQueries({
              queryKey: productKeys.marketAvailability(productId, releaseId),
            }),
            client.invalidateQueries({
              queryKey: productKeys.lifecycleTimeline(productId, releaseId),
            }),
          ]
        : []),
    ]);
  };
}

export function useCreateProductMutation() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: CreateProductInput) => productsApi.create(input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateProductMutation(productId: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: UpdateProductInput) =>
      productsApi.update(productId, input),
    onSuccess: () => invalidate(productId),
  });
}

export function useArchiveProductMutation(productId: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: ArchiveProductInput) =>
      productsApi.archive(productId, input),
    onSuccess: () => invalidate(productId),
  });
}

export function useMoveProductLegalEntityMutation(productId: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: MoveProductLegalEntityInput) =>
      productsApi.moveLegalEntity(productId, input),
    onSuccess: () => invalidate(productId),
  });
}

export function useCreateReleaseMutation(productId: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: CreateReleaseInput) =>
      productsApi.createRelease(productId, input),
    onSuccess: () => invalidate(productId),
  });
}

export function useUpdateReleaseMutation(productId: string, releaseId: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: UpdateReleaseInput) =>
      productsApi.updateRelease(productId, releaseId, input),
    onSuccess: () => invalidate(productId),
  });
}

export function useArchiveReleaseMutation(
  productId: string,
  releaseId: string,
) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: ArchiveReleaseInput) =>
      productsApi.archiveRelease(productId, releaseId, input),
    onSuccess: () => invalidate(productId),
  });
}

function useInvalidateProductCompliance(productId: string) {
  const client = useQueryClient();
  return async () => {
    await Promise.all([
      client.invalidateQueries({
        queryKey: productKeys.modificationAssessments(productId),
      }),
      client.invalidateQueries({
        queryKey: productKeys.securityUpdateArtifacts(productId),
      }),
      client.invalidateQueries({ queryKey: productKeys.detail(productId) }),
      client.invalidateQueries({ queryKey: productKeys.releases(productId) }),
      client.invalidateQueries({
        queryKey: productKeys.supportPeriods(productId),
      }),
      client.invalidateQueries({
        queryKey: productKeys.supportRetention(productId),
      }),
    ]);
  };
}

export function useCreateSubstantialModificationAssessmentMutation(
  productId: string,
) {
  const invalidate = useInvalidateProductCompliance(productId);
  return useMutation({
    mutationFn: (input: CreateSubstantialModificationAssessmentInput) =>
      productsApi.createSubstantialModificationAssessment(productId, input),
    onSuccess: () => invalidate(),
  });
}

export function useCreateSubstantialModificationAssessmentDraftMutation(
  productId: string,
) {
  const invalidate = useInvalidateProductCompliance(productId);
  return useMutation({
    mutationFn: (input: CreateSubstantialModificationAssessmentDraftInput) =>
      productsApi.createSubstantialModificationAssessmentDraft(
        productId,
        input,
      ),
    onSuccess: () => invalidate(),
  });
}

export function useReassessSubstantialModificationAssessmentMutation(
  productId: string,
  assessmentId: string,
) {
  const invalidate = useInvalidateProductCompliance(productId);
  return useMutation({
    mutationFn: (input: ReassessSubstantialModificationAssessmentInput) =>
      productsApi.reassessSubstantialModificationAssessment(
        productId,
        assessmentId,
        input,
      ),
    onSuccess: () => invalidate(),
  });
}

export function useReviewSubstantialModificationAssessmentMutation(
  productId: string,
  assessmentId: string,
) {
  const invalidate = useInvalidateProductCompliance(productId);
  return useMutation({
    mutationFn: (input: ReviewSubstantialModificationAssessmentInput) =>
      productsApi.reviewSubstantialModificationAssessment(
        productId,
        assessmentId,
        input,
      ),
    onSuccess: () => invalidate(),
  });
}

export function useReserveSecurityUpdateArtifactMutation(productId: string) {
  const invalidate = useInvalidateProductCompliance(productId);
  return useMutation({
    mutationFn: (input: ReserveSecurityUpdateArtifactInput) =>
      productsApi.reserveSecurityUpdateArtifact(productId, input),
    onSuccess: () => invalidate(),
  });
}

export function useFinalizeSecurityUpdateArtifactMutation(
  productId: string,
  artifactId: string,
) {
  const invalidate = useInvalidateProductCompliance(productId);
  return useMutation({
    mutationFn: (input: FinalizeSecurityUpdateArtifactInput) =>
      productsApi.finalizeSecurityUpdateArtifact(productId, artifactId, input),
    onSuccess: () => invalidate(),
  });
}

export function useFinalizeReservedSecurityUpdateArtifactMutation(
  productId: string,
) {
  const invalidate = useInvalidateProductCompliance(productId);
  return useMutation({
    mutationFn: ({
      artifactId,
      input,
    }: Readonly<{
      artifactId: string;
      input: FinalizeSecurityUpdateArtifactInput;
    }>) =>
      productsApi.finalizeSecurityUpdateArtifact(productId, artifactId, input),
    onSuccess: () => invalidate(),
  });
}

export function useReviewSecurityUpdateArtifactMutation(
  productId: string,
  artifactId: string,
) {
  const invalidate = useInvalidateProductCompliance(productId);
  return useMutation({
    mutationFn: (input: ReviewSecurityUpdateArtifactInput) =>
      productsApi.reviewSecurityUpdateArtifact(productId, artifactId, input),
    onSuccess: () => invalidate(),
  });
}

export function usePublishSecurityUpdateArtifactMutation(
  productId: string,
  artifactId: string,
) {
  const invalidate = useInvalidateProductCompliance(productId);
  return useMutation({
    mutationFn: (input: PublishSecurityUpdateArtifactInput) =>
      productsApi.publishSecurityUpdateArtifact(productId, artifactId, input),
    onSuccess: () => invalidate(),
  });
}

export function useReplaceSecurityUpdateArtifactMutation(
  productId: string,
  artifactId: string,
) {
  const invalidate = useInvalidateProductCompliance(productId);
  return useMutation({
    mutationFn: (input: ReplaceSecurityUpdateArtifactInput) =>
      productsApi.replaceSecurityUpdateArtifact(productId, artifactId, input),
    onSuccess: () => invalidate(),
  });
}

export function useWithdrawSecurityUpdateArtifactMutation(
  productId: string,
  artifactId: string,
) {
  const invalidate = useInvalidateProductCompliance(productId);
  return useMutation({
    mutationFn: (input: WithdrawSecurityUpdateArtifactInput) =>
      productsApi.withdrawSecurityUpdateArtifact(productId, artifactId, input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateSecurityUpdateArtifactMetadataMutation(
  productId: string,
  artifactId: string,
) {
  const invalidate = useInvalidateProductCompliance(productId);
  return useMutation({
    mutationFn: (input: UpdateSecurityUpdateArtifactMetadataInput) =>
      productsApi.updateSecurityUpdateArtifactMetadata(
        productId,
        artifactId,
        input,
      ),
    onSuccess: () => invalidate(),
  });
}

export function useAddReleaseMarketAvailabilityMutation(
  productId: string,
  releaseId: string,
) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: AddReleaseMarketAvailabilityInput) =>
      productsApi.addReleaseMarketAvailability(productId, releaseId, input),
    onSuccess: () => invalidate(productId, releaseId),
  });
}

export function useRemoveReleaseMarketAvailabilityMutation(
  productId: string,
  releaseId: string,
) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: ({
      countryCode,
      input,
    }: Readonly<{
      countryCode: string;
      input: RemoveReleaseMarketAvailabilityInput;
    }>) =>
      productsApi.removeReleaseMarketAvailability(
        productId,
        releaseId,
        countryCode,
        input,
      ),
    onSuccess: () => invalidate(productId, releaseId),
  });
}

export function useCorrectReleaseMarketAvailabilityMutation(
  productId: string,
  releaseId: string,
) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: CorrectReleaseMarketAvailabilityInput) =>
      productsApi.correctReleaseMarketAvailability(productId, releaseId, input),
    onSuccess: () => invalidate(productId, releaseId),
  });
}

export function useTransitionReleaseLifecycleMutation(
  productId: string,
  releaseId: string,
) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: TransitionReleaseLifecycleInput) =>
      productsApi.transitionReleaseLifecycle(productId, releaseId, input),
    onSuccess: () => invalidate(productId, releaseId),
  });
}

export function useCorrectPlacedOnMarketDateMutation(
  productId: string,
  releaseId: string,
) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: CorrectPlacedOnMarketDateInput) =>
      productsApi.correctPlacedOnMarketDate(productId, releaseId, input),
    onSuccess: () => invalidate(productId, releaseId),
  });
}

export function usePreviewSupportPeriodMutation(productId: string) {
  return useMutation({
    mutationFn: (input: PreviewSupportPeriodChangeRequest) =>
      productsApi.previewSupportPeriod(productId, input),
  });
}

export function useCreateSupportPeriodMutation(productId: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: CreateSupportPeriodRequest) =>
      productsApi.createSupportPeriod(productId, input),
    onSuccess: () => invalidate(productId, undefined, { support: true }),
  });
}

export function useSupersedeSupportPeriodMutation(productId: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: ({
      supportPeriodId,
      input,
    }: Readonly<{
      supportPeriodId: string;
      input: SupersedeSupportPeriodRequest;
    }>) =>
      productsApi.supersedeSupportPeriod(productId, supportPeriodId, input),
    onSuccess: () => invalidate(productId, undefined, { support: true }),
  });
}

export function useUpdateSupportAlertIntervalsMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSupportAlertIntervalsRequest) =>
      productsApi.updateSupportAlertIntervals(input),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({
          queryKey: productKeys.supportAlertIntervals,
        }),
        client.invalidateQueries({ queryKey: productKeys.all }),
      ]);
    },
  });
}

export function useCreateSoftwareBaselineMutation() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: CreateSoftwareBaselineInput) =>
      productsApi.createSoftwareBaseline(input),
    onSuccess: () => invalidate(),
  });
}

export function useAppendSoftwareBaselineRevisionMutation(baselineId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: AppendSoftwareBaselineRevisionInput) =>
      productsApi.appendSoftwareBaselineRevision(baselineId, input),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({
          queryKey: productKeys.baselineRevisions(baselineId),
        }),
        client.invalidateQueries({ queryKey: productKeys.all }),
      ]);
    },
  });
}

export function useArchiveSoftwareBaselineMutation(baselineId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ArchiveSoftwareBaselineInput) =>
      productsApi.archiveSoftwareBaseline(baselineId, input),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({
          queryKey: productKeys.baselineRevisions(baselineId),
        }),
        client.invalidateQueries({ queryKey: productKeys.all }),
      ]);
    },
  });
}

export function useAssignSoftwareBaselineMembershipMutation(productId: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: AssignSoftwareBaselineMembershipInput) =>
      productsApi.assignSoftwareBaselineMembership(productId, input),
    onSuccess: () => invalidate(productId, undefined, { relationships: true }),
  });
}

export function useEndSoftwareBaselineMembershipMutation(productId: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: ({
      membershipId,
      input,
    }: Readonly<{
      membershipId: string;
      input: EndSoftwareBaselineMembershipInput;
    }>) =>
      productsApi.endSoftwareBaselineMembership(productId, membershipId, input),
    onSuccess: () => invalidate(productId, undefined, { relationships: true }),
  });
}

export function useCreateProductVariantRelationshipMutation(productId: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: CreateProductVariantRelationshipInput) =>
      productsApi.createProductVariantRelationship(
        input.variantProductId,
        input,
      ),
    onSuccess: async (_result, input) => {
      await Promise.all([
        invalidate(productId, undefined, { relationships: true }),
        ...(input.variantProductId === productId
          ? []
          : [
              invalidate(input.variantProductId, undefined, {
                relationships: true,
              }),
            ]),
      ]);
    },
  });
}

export function useEndProductVariantRelationshipMutation(productId: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: ({
      relationshipId,
      input,
    }: Readonly<{
      relationshipId: string;
      input: EndProductVariantRelationshipInput;
    }>) =>
      productsApi.endProductVariantRelationship(
        productId,
        relationshipId,
        input,
      ),
    onSuccess: () => invalidate(productId, undefined, { relationships: true }),
  });
}

export function usePreviewProductComponentLinkMutation(productId: string) {
  return useMutation({
    mutationFn: (input: PreviewProductComponentLinkInput) =>
      productsApi.previewProductComponentLink(productId, input),
  });
}

export function useCreateProductComponentLinkMutation(productId: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: CreateProductComponentLinkInput) =>
      productsApi.createProductComponentLink(productId, input),
    onSuccess: () => invalidate(productId, undefined, { relationships: true }),
  });
}

export function useSupersedeProductComponentLinkMutation(productId: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: ({
      relationshipId,
      input,
    }: Readonly<{
      relationshipId: string;
      input: SupersedeProductComponentLinkInput;
    }>) =>
      productsApi.supersedeProductComponentLink(
        productId,
        relationshipId,
        input,
      ),
    onSuccess: () => invalidate(productId, undefined, { relationships: true }),
  });
}

export function useEndProductComponentLinkMutation(productId: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: ({
      relationshipId,
      input,
    }: Readonly<{
      relationshipId: string;
      input: EndProductComponentLinkInput;
    }>) =>
      productsApi.endProductComponentLink(productId, relationshipId, input),
    onSuccess: () => invalidate(productId, undefined, { relationships: true }),
  });
}

export function useRequestRelationshipReevaluationMutation(productId: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: RequestRelationshipReevaluationInput) =>
      productsApi.requestRelationshipReevaluation(productId, input),
    onSuccess: () => invalidate(productId, undefined, { relationships: true }),
  });
}
