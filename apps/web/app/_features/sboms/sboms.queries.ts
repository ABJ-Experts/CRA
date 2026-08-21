"use client";

import type {
  CreateSbomCiCredentialInput,
  RevokeSbomCiCredentialInput,
  SbomJobResponse,
  SbomSourceHistoryQuery,
  SbomSourceHistoryResponse,
  SbomValidationReportResponse,
} from "@repo/contracts/sboms";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { sbomsApi } from "./sboms.api";
import { sbomKeys } from "./sboms.keys";

function shouldPoll(status: SbomJobResponse["job"]["status"] | undefined) {
  return status === "queued" || status === "processing" || status === "failed";
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
