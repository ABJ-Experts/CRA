"use client";

import type {
  CreateSbomCiCredentialInput,
  CreateSbomDiffInput,
  RevokeSbomCiCredentialInput,
  SbomJobResponse,
  SbomComponentSearchQuery,
  SbomComponentSearchResponse,
  SbomDependencyTreeQuery,
  SbomDependencyTreeResponse,
  SbomDiffComponentsQuery,
  SbomDiffComponentsResponse,
  SbomDiffFindingsQuery,
  SbomDiffFindingsResponse,
  SbomDiffReportResponse,
  SbomDocumentDetailResponse,
  SbomDocumentListQuery,
  SbomDocumentListResponse,
  SbomQualityFindingsQuery,
  SbomQualityFindingsResponse,
  SbomQualityReportResponse,
  RetrySbomDiffInput,
  SbomSourceDiffQuery,
  SbomSourceDiffResponse,
  SbomSourceHistoryQuery,
  SbomSourceHistoryResponse,
  SbomValidationReportResponse,
} from "@repo/contracts/sboms";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { sbomsApi } from "./sboms.api";
import { sbomKeys } from "./sboms.keys";

function shouldPoll(status: SbomJobResponse["job"]["status"] | undefined) {
  return status === "queued" || status === "processing" || status === "failed";
}

function shouldPollQuality(
  status: SbomQualityReportResponse["report"]["state"] | undefined,
) {
  return status === "queued" || status === "processing";
}

function shouldPollDiff(
  state: SbomDiffReportResponse["report"]["state"] | undefined,
) {
  return state === "queued" || state === "processing";
}

export function useSbomJobQuery(jobId: string | null, enabled: boolean) {
  return useQuery<SbomJobResponse>({
    queryKey: jobId === null ? sbomKeys.jobs : sbomKeys.job(jobId),
    enabled: enabled && jobId !== null,
    retry: false,
    refetchInterval: (query) =>
      shouldPoll(query.state.data?.job.status) ? 2_000 : false,
    queryFn: ({ signal }) => {
      if (jobId === null)
        throw new Error("An SBOM job identifier is required.");
      return sbomsApi.getJob(jobId, signal);
    },
  });
}

export function useSbomSourceHistoryQuery(
  productId: string,
  releaseId: string,
  query: Readonly<Partial<SbomSourceHistoryQuery>>,
  enabled: boolean,
) {
  return useQuery<SbomSourceHistoryResponse>({
    queryKey: sbomKeys.sourceHistory(productId, releaseId, query),
    enabled: enabled && productId !== "" && releaseId !== "",
    retry: false,
    queryFn: ({ signal }) =>
      sbomsApi.listSourcesForRelease(productId, releaseId, query, signal),
  });
}

export function useSbomValidationReportQuery(
  sourceId: string | null,
  enabled: boolean,
) {
  return useQuery<SbomValidationReportResponse>({
    queryKey:
      sourceId === null
        ? sbomKeys.validationReports
        : sbomKeys.validationReport(sourceId),
    enabled: enabled && sourceId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (sourceId === null)
        throw new Error("An SBOM source identifier is required.");
      return sbomsApi.getValidationReport(sourceId, signal);
    },
  });
}

export function useSbomDocumentsForReleaseQuery(
  productId: string,
  releaseId: string,
  query: Readonly<Partial<SbomDocumentListQuery>>,
  enabled: boolean,
) {
  return useQuery<SbomDocumentListResponse>({
    queryKey: sbomKeys.documentsForRelease(productId, releaseId, query),
    enabled: enabled && productId !== "" && releaseId !== "",
    retry: false,
    queryFn: ({ signal }) =>
      sbomsApi.listDocumentsForRelease(productId, releaseId, query, signal),
  });
}

export function useSbomDocumentDetailQuery(
  documentId: string | null,
  enabled: boolean,
) {
  return useQuery<SbomDocumentDetailResponse>({
    queryKey:
      documentId === null ? sbomKeys.documents : sbomKeys.document(documentId),
    enabled: enabled && documentId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (documentId === null)
        throw new Error("An SBOM document identifier is required.");
      return sbomsApi.getDocument(documentId, signal);
    },
  });
}

export function useSbomQualityReportQuery(
  sourceId: string | null,
  enabled: boolean,
) {
  return useQuery<SbomQualityReportResponse>({
    queryKey:
      sourceId === null
        ? sbomKeys.qualityReports
        : sbomKeys.qualityReport(sourceId),
    enabled: enabled && sourceId !== null,
    retry: false,
    refetchInterval: (query) =>
      shouldPollQuality(query.state.data?.report.state) ? 2_000 : false,
    queryFn: ({ signal }) => {
      if (sourceId === null)
        throw new Error("An SBOM source identifier is required.");
      return sbomsApi.getQualityReport(sourceId, signal);
    },
  });
}

export function useSbomQualityFindingsQuery(
  sourceId: string | null,
  query: Readonly<Partial<SbomQualityFindingsQuery>>,
  enabled: boolean,
) {
  return useQuery<SbomQualityFindingsResponse>({
    queryKey:
      sourceId === null
        ? sbomKeys.qualityReports
        : sbomKeys.qualityFindings(sourceId, query),
    enabled: enabled && sourceId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (sourceId === null)
        throw new Error("An SBOM source identifier is required.");
      return sbomsApi.listQualityFindings(sourceId, query, signal);
    },
  });
}

export function useSbomDiffReportQuery(
  diffId: string | null,
  enabled: boolean,
) {
  return useQuery<SbomDiffReportResponse>({
    queryKey:
      diffId === null ? sbomKeys.diffReports : sbomKeys.diffReport(diffId),
    enabled: enabled && diffId !== null,
    retry: false,
    refetchInterval: (query) =>
      shouldPollDiff(query.state.data?.report.state) ? 2_000 : false,
    queryFn: ({ signal }) => {
      if (diffId === null)
        throw new Error("An SBOM diff identifier is required.");
      return sbomsApi.getDiff(diffId, signal);
    },
  });
}

export function useSbomSourceDiffQuery(
  sourceId: string | null,
  query: Readonly<Partial<SbomSourceDiffQuery>>,
  enabled: boolean,
) {
  return useQuery<SbomSourceDiffResponse>({
    queryKey:
      sourceId === null
        ? sbomKeys.sourceDiffReports
        : sbomKeys.sourceDiffReport(sourceId, query),
    enabled: enabled && sourceId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (sourceId === null)
        throw new Error("An SBOM source identifier is required.");
      return sbomsApi.getSourceDiff(sourceId, query, signal);
    },
  });
}

export function useSbomDiffComponentsQuery(
  diffId: string | null,
  query: Readonly<Partial<SbomDiffComponentsQuery>>,
  enabled: boolean,
) {
  return useQuery<SbomDiffComponentsResponse>({
    queryKey:
      diffId === null
        ? sbomKeys.diffReports
        : sbomKeys.diffComponents(diffId, query),
    enabled: enabled && diffId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (diffId === null)
        throw new Error("An SBOM diff identifier is required.");
      return sbomsApi.listDiffComponents(diffId, query, signal);
    },
  });
}

export function useSbomDiffFindingsQuery(
  diffId: string | null,
  query: Readonly<Partial<SbomDiffFindingsQuery>>,
  enabled: boolean,
) {
  return useQuery<SbomDiffFindingsResponse>({
    queryKey:
      diffId === null
        ? sbomKeys.diffReports
        : sbomKeys.diffFindings(diffId, query),
    enabled: enabled && diffId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (diffId === null)
        throw new Error("An SBOM diff identifier is required.");
      return sbomsApi.listDiffFindings(diffId, query, signal);
    },
  });
}

export function useStartSbomDiffMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sourceId,
      input,
    }: {
      sourceId: string;
      input: CreateSbomDiffInput;
    }) => sbomsApi.startDiff(sourceId, input),
    onSuccess: (response) => {
      if (response.status === "queued") {
        queryClient.setQueryData(sbomKeys.diffReport(response.report.id), {
          report: response.report,
        });
      }
    },
  });
}

export function useRetrySbomDiffMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      diffId,
      input,
    }: {
      diffId: string;
      input: RetrySbomDiffInput;
    }) => sbomsApi.retryDiff(diffId, input),
    onSuccess: (response) => {
      if (response.status === "queued") {
        queryClient.setQueryData(sbomKeys.diffReport(response.report.id), {
          report: response.report,
        });
      }
    },
  });
}

export function useSbomComponentSearchQuery(
  documentId: string | null,
  query: Readonly<Partial<SbomComponentSearchQuery>>,
  enabled: boolean,
) {
  return useQuery<SbomComponentSearchResponse>({
    queryKey:
      documentId === null
        ? sbomKeys.componentSearches
        : sbomKeys.componentSearch(documentId, query),
    enabled: enabled && documentId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (documentId === null)
        throw new Error("An SBOM document identifier is required.");
      return sbomsApi.searchComponents(documentId, query, signal);
    },
  });
}

export function useSbomDependencyTreeChildrenQuery(
  documentId: string | null,
  query: Readonly<Partial<SbomDependencyTreeQuery>>,
  enabled: boolean,
) {
  return useQuery<SbomDependencyTreeResponse>({
    queryKey:
      documentId === null
        ? sbomKeys.documents
        : sbomKeys.dependencyTreeChildren(documentId, query),
    enabled: enabled && documentId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (documentId === null)
        throw new Error("An SBOM document identifier is required.");
      return sbomsApi.listDependencyTreeChildren(documentId, query, signal);
    },
  });
}

export function useSbomDependencyTreeChildrenQueries(
  documentId: string | null,
  parents: readonly Readonly<Partial<SbomDependencyTreeQuery>>[],
  enabled: boolean,
) {
  return useQueries({
    queries:
      documentId === null
        ? []
        : parents.map((query) => ({
            queryKey: sbomKeys.dependencyTreeChildren(documentId, query),
            enabled,
            retry: false,
            queryFn: ({ signal }: { signal: AbortSignal }) =>
              sbomsApi.listDependencyTreeChildren(documentId, query, signal),
          })),
  });
}

export function useSbomCiCredentialsQuery(enabled: boolean) {
  return useQuery({
    queryKey: sbomKeys.ciCredentials,
    enabled,
    retry: false,
    queryFn: ({ signal }) => sbomsApi.listCiCredentials(signal),
  });
}

export function useCreateSbomCiCredentialMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSbomCiCredentialInput) =>
      sbomsApi.createCiCredential(input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: sbomKeys.ciCredentials }),
  });
}

export function useRevokeSbomCiCredentialMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      credentialId,
      input,
    }: {
      credentialId: string;
      input: RevokeSbomCiCredentialInput;
    }) => sbomsApi.revokeCiCredential(credentialId, input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: sbomKeys.ciCredentials }),
  });
}
